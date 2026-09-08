#!/usr/bin/env node
/**
 * 每日资讯简报生成器（GitHub Actions 用）
 * 流程：RSS/API 聚合 → GLM 摘要改写 → 链接校验 → 写 briefing-data.js + daily-briefing/日期.md
 *
 * 特性：
 * - 零 npm 依赖，Node 20+ 直接运行（Actions 免安装）
 * - ZHIPU_API_KEY 未配置或调用失败时自动降级为"原始标题模式"，流水线永不中断
 * - 防 LLM 幻觉：输出的每条链接必须来自真实抓取集合，逐字匹配 + 去重 + 泛化链接过滤
 * - 智谱 Coding 套餐 Key 兼容：普通端点报 1113 时自动切 coding 端点
 *
 * 环境变量：
 *   ZHIPU_API_KEY   智谱 API Key（可选，缺失则用原始标题模式）
 *   ZHIPU_MODEL     模型名，默认 glm-4.7
 *   ZHIPU_API_BASE  API 端点，默认 https://open.bigmodel.cn/api/paas/v4
 *   OUT_DIR         输出目录，默认当前目录
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = process.env.OUT_DIR || '.';
const API_BASE = (process.env.ZHIPU_API_BASE || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, '');
const CODING_BASE = 'https://open.bigmodel.cn/api/coding/paas/v4';
const API_KEY = (process.env.ZHIPU_API_KEY || '').trim();
const MODEL = (process.env.ZHIPU_MODEL || 'glm-4.7').trim();

const RSSHUB_MIRRORS = ['https://rsshub.app', 'https://rsshub.rssforever.com', 'https://hub.slarker.me'];
const PER_SECTION_FINAL = 6;   // 每板块最终条数
const PER_SECTION_RAW = 12;    // 每板块送入 LLM 的原始条数
const RECENT_HOURS = 48;       // 时效过滤窗口（不足时自动放宽）

// ---------- 基础工具 ----------
function log(...a) { console.log('[briefing]', ...a); }

function bjDate(d = new Date()) {
  // 北京时间 YYYY-MM-DD（en-CA 的 ISO 格式）
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

async function fetchText(url, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 DailyBriefingBot/1.0', 'Accept': '*/*' }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.text();
  } finally { clearTimeout(timer); }
}

function stripCdata(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ---------- RSS / Atom 解析（容错式，不依赖 XML 库） ----------
function parseFeed(xml) {
  const raw = stripCdata(xml);
  const blocks = raw.match(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const pick = (re) => { const m = b.match(re); return m ? stripTags(m[1]) : ''; };
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let link = pick(/<link[^>]*?href=["']([^"']+)["'][^>]*>/i)
            || pick(/<link[^>]*>([\s\S]*?)<\/link>/i)
            || pick(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const pub = pick(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)
             || pick(/<updated[^>]*>([\s\S]*?)<\/updated>/i)
             || pick(/<published[^>]*>([\s\S]*?)<\/published>/i)
             || pick(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    const desc = pick(/<description[^>]*>([\s\S]*?)<\/description>/i)
              || pick(/<summary[^>]*>([\s\S]*?)<\/summary>/i)
              || pick(/<content[^>]*>([\s\S]*?)<\/content>/i);
    if (title && /^https?:\/\//.test(link)) {
      const pd = pub ? new Date(pub) : null;
      items.push({ title, link, pub: isNaN(pd) ? null : pd, desc: desc.slice(0, 280) });
    }
  }
  return items;
}

// ---------- 来源友好名 ----------
const SOURCE_MAP = {
  '36kr.com': '36氪', 'wallstreetcn.com': '华尔街见闻', 'thepaper.cn': '澎湃新闻',
  'sspai.com': '少数派', 'solidot.org': 'Solidot', 'cls.cn': '财联社',
  'jiqizhixin.com': '机器之心', 'qbitai.com': '量子位', 'news.qq.com': '腾讯新闻',
  'view.inews.qq.com': '腾讯新闻', '163.com': '网易', 'sina.com.cn': '新浪',
  'sina.com': '新浪', 'stcn.com': '证券时报', 'people.com.cn': '人民网',
  'nbd.com.cn': '每日经济新闻', 'cnbeta.com': 'cnBeta', 'hn.algolia.com': 'Hacker News',
  'github.com': 'GitHub', 'zhihu.com': '知乎', 'huxiu.com': '虎嗅', 'infoq.cn': 'InfoQ'
};
function friendlySource(url, fallback) {
  if (fallback) return fallback;
  let h = ''; try { h = new URL(url).hostname.replace(/^www\./, ''); } catch { return '网络'; }
  for (const k of Object.keys(SOURCE_MAP)) if (h === k || h.endsWith('.' + k)) return SOURCE_MAP[k];
  return h;
}

// ---------- 数据源：feeds.json ----------
const FEEDS_PATH = fileURLToPath(new URL('feeds.json', import.meta.url));
function loadFeeds() {
  try { return JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 scripts/feeds.json 失败：' + e.message); }
}

async function fetchFeedEntries(feed) {
  // 构造候选 URL：普通源直接用；RSSHub 路由依次尝试镜像
  const candidates = feed.rsshubRoute
    ? RSSHUB_MIRRORS.map(m => m + feed.rsshubRoute)
    : [feed.url];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const xml = await fetchText(url, feed.rsshubRoute ? 12000 : 15000);
      const items = parseFeed(xml);
      if (items.length) return items.map(i => ({ ...i, source: friendlySource(i.link, feed.source) }));
      lastErr = new Error('解析出 0 条');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('抓取失败');
}

// ---------- GitHub Trending（HTML 抓取，无需认证） ----------
async function githubTrending(max) {
  const html = await fetchText('https://github.com/trending?since=daily', 20000);
  const out = [];
  const re = /<h2[^>]*>\s*<a[^>]+href="\/([^"?/]+\/[^"?/]+)"[^>]*>/g;
  let m;
  const seen = {};
  while ((m = re.exec(html)) && out.length < max) {
    const repo = m[1];
    if (seen[repo]) continue;
    seen[repo] = 1;
    // 在该仓库所在 article 块内找描述、语言、今日 star
    const after = html.slice(m.index, m.index + 2600);
    const desc = stripTags((after.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
    const lang = stripTags((after.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
    const starsToday = stripTags((after.match(/([\d,\.]+)\s+stars\s+today/i) || [])[1] || '');
    const meta = [];
    if (lang) meta.push(lang);
    if (starsToday) meta.push('今日 +' + starsToday + ' stars');
    out.push({
      text: repo + (desc ? '：' + desc : '') + (meta.length ? '（' + meta.join('，') + '）' : ''),
      source: 'GitHub', link: 'https://github.com/' + repo, content: desc, pub: new Date()
    });
  }
  return out;
}

// ---------- Hacker News 头条（Algolia API，稳定免认证） ----------
async function hackerNews(max) {
  const j = JSON.parse(await fetchText('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=' + max * 2));
  return (j.hits || []).filter(h => h && h.title).slice(0, max).map(h => ({
    text: h.title + (h.points ? '（' + h.points + ' 分 · ' + (h.num_comments || 0) + ' 评论）' : ''),
    source: 'Hacker News',
    link: h.url || 'https://news.ycombinator.com/item?id=' + h.objectID,
    content: '', pub: new Date((h.created_at_i || 0) * 1000)
  }));
}

// ---------- 聚合 ----------
async function aggregate(cfg, dateStr) {
  const failures = [];
  const sections = [];
  for (const sec of cfg.sections) {
    const entries = [];
    await Promise.all(sec.feeds.map(async (f) => {
      try { entries.push(...await fetchFeedEntries(f)); }
      catch (e) { failures.push((f.source || f.url || f.rsshubRoute) + '：' + e.message); }
    }));
    let items = dedupe(entries);
    // 时效过滤：优先 48h 内，不足 4 条则放宽
    const fresh = items.filter(i => !i.pub || (Date.now() - i.pub) <= RECENT_HOURS * 3600e3);
    if (fresh.length >= 4) items = fresh;
    items.sort((a, b) => (b.pub ? b.pub.getTime() : 0) - (a.pub ? a.pub.getTime() : 0));
    if (items.length) sections.push({ title: sec.title, raw: items.slice(0, PER_SECTION_RAW) });
  }
  // GitHub 热点单列板块
  if (cfg.githubTrending) {
    try {
      const gh = await githubTrending(cfg.githubTrending);
      if (gh.length) sections.push({ title: 'GitHub 热点项目', raw: gh });
    } catch (e) { failures.push('GitHub Trending：' + e.message); }
  }
  // HN 并入"其他"
  if (cfg.hackerNews) {
    try {
      const hn = await hackerNews(cfg.hackerNews);
      const other = sections.find(s => s.title === '其他');
      if (other) { other.raw = dedupe(other.raw.concat(hn)).slice(0, PER_SECTION_RAW); }
      else if (hn.length) sections.push({ title: '其他', raw: hn });
    } catch (e) { failures.push('Hacker News：' + e.message); }
  }
  return { sections, failures };
}

function dedupe(items) {
  const seenUrl = {}, seenTitle = {}, out = [];
  for (const i of items) {
    const k = String(i.link).replace(/#.*$/, '');
    const t = String(i.title || i.text).trim();
    if (!k || seenUrl[k] || seenTitle[t]) continue;
    seenUrl[k] = 1; seenTitle[t] = 1; out.push(i);
  }
  return out;
}

// ---------- LLM 摘要 ----------
async function llmChat(messages, { temperature = 0.3, max_tokens = 6000 } = {}) {
  const body = JSON.stringify({ model: MODEL, messages, temperature, stream: false, max_tokens });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY }, body };
  let resp = await fetch(API_BASE + '/chat/completions', opts);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // Coding 套餐 Key 兼容：普通端点报 1113 时切 coding 端点
    if (/1113|余额不足|无可用资源包/i.test(txt) && API_BASE.indexOf('/coding/') < 0) {
      log('普通端点报 1113，自动切 coding 端点重试');
      resp = await fetch(CODING_BASE + '/chat/completions', opts);
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '：' + (await resp.text().catch(() => '')).slice(0, 200));
  }
  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function llmSummarize(sections, dateStr) {
  const ctx = sections.map(s => ({
    title: s.title,
    items: s.raw.map(i => ({ title: i.title || i.text, source: i.source, link: i.link, snippet: i.desc || i.content || '' }))
  }));
  const sys = '你是一位资深新闻编辑。请基于用户提供的真实来源生成每日资讯JSON。要求：保持输入的板块顺序与结构；每条text写成一句简洁的中文摘要（可融合标题与片段中的关键数据）；source沿用输入来源；link必须逐字复制输入中的URL，一个URL只能用一次。**严禁**：①编造输入中不存在的链接或来源；②使用网站首页/栏目列表页/聚合页作为链接；③同一URL出现在多条资讯中。信息量不足的条目直接丢弃。只返回JSON，不要输出其他文本。';
  const user = '日期：' + dateStr + '\n真实来源：' + JSON.stringify(ctx)
    + '\n\n请输出：{"date":"' + dateStr + '","sections":[{"title":"分类名","items":[{"text":"摘要","source":"来源","link":"URL"}]}]}';
  const raw = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }]);
  const m = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : raw);
}

// ---------- 校验（防幻觉：链接必须在真实集合内） ----------
function isGenericLink(u) {
  try {
    const p = new URL(u);
    const pathName = (p.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathName === '/') return true;
    if (/^\/(news|brief|briefing|daily|archive|list|tag|category|search|trending|feed|rss)$/i.test(pathName)) return true;
    return false;
  } catch { return true; }
}

function validate(parsed, sections) {
  const byUrl = {};
  sections.forEach(s => s.raw.forEach(i => { byUrl[String(i.link).replace(/#.*$/, '')] = i; }));
  const used = {};
  const out = [];
  (parsed && parsed.sections || []).forEach(sec => {
    if (!sec || !Array.isArray(sec.items)) return;
    const items = [];
    sec.items.forEach(it => {
      const key = String(it && it.link || '').trim().replace(/#.*$/, '');
      if (!key || used[key] || isGenericLink(key)) return;
      const src = byUrl[key];
      if (!src) return; // 不在真实抓取集合内 → 丢弃
      used[key] = 1;
      items.push({ text: String(it.text || src.title || src.text || '').trim(), source: src.source, link: src.link, content: (src.desc || src.content || '').slice(0, 220) });
    });
    if (items.length) out.push({ title: String(sec.title || '').trim(), items: items.slice(0, PER_SECTION_FINAL) });
  });
  return out;
}

function rawFallback(sections) {
  return sections.map(s => ({
    title: s.title,
    items: s.raw.slice(0, PER_SECTION_FINAL).map(i => ({
      text: (i.title || i.text).trim(), source: i.source, link: i.link, content: (i.desc || '').slice(0, 220)
    }))
  }));
}

// ---------- 输出 ----------
const EMOJI = { 'AI发展': '🤖', '财经': '📈', '社会新闻': '🌍', 'GitHub 热点项目': '⭐', '其他': '📌' };
const emojiOf = (t) => EMOJI[t] || (t.indexOf('GitHub') >= 0 ? '⭐' : '📌');

function writeMarkdown(dateStr, sections, mode, failures) {
  const [y, mo, d] = dateStr.split('-');
  let md = '# 每日资讯简报 — ' + y + '年' + mo + '月' + d + '日\n\n';
  sections.forEach(sec => {
    md += '## ' + emojiOf(sec.title) + ' ' + sec.title + '\n';
    sec.items.forEach((it, idx) => {
      const t = it.text;
      const sp = t.indexOf('：');
      const head = sp > 0 && sp < 40 ? '**' + t.slice(0, sp) + '**' : '**' + t.slice(0, Math.min(24, t.length)) + '**';
      const rest = sp > 0 && sp < 40 ? t.slice(sp + 1) : t.slice(Math.min(24, t.length));
      md += (idx + 1) + '. ' + head + (rest ? ' — ' + rest : '') + '。[' + it.source + '](' + it.link + ')\n';
    });
    md += '\n';
  });
  md += '---\n<!-- 生成模式：' + mode + (failures.length ? '｜失败源：' + failures.join('；') : '') + ' -->\n';
  const dir = path.join(OUT_DIR, 'daily-briefing');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, dateStr + '.md'), md);
}

function updateArchive(dateStr) {
  let prev = [];
  try {
    const old = fs.readFileSync(path.join(OUT_DIR, 'briefing-data.js'), 'utf8');
    const m = old.match(/BRIEFING_ARCHIVE\s*=\s*(\[[\s\S]*?\])/);
    if (m) prev = JSON.parse(m[1]);
  } catch { /* 首次生成 */ }
  const arch = [dateStr, ...prev.filter(d => d !== dateStr)].slice(0, 8);
  return arch;
}

// ---------- 主流程 ----------
(async () => {
  const dateStr = bjDate();
  log('简报日期（北京时间）：', dateStr, '｜模型：', API_KEY ? MODEL : '（无 Key，原始标题模式）');

  const cfg = loadFeeds();
  const { sections: aggSections, failures } = await aggregate(cfg, dateStr);
  if (failures.length) log('以下数据源失败（已跳过）：', failures.join(' | '));
  if (!aggSections.length) throw new Error('所有数据源均失败，未生成任何内容');

  let finalSections = null;
  let mode = '原始标题';
  if (API_KEY) {
    for (let attempt = 1; attempt <= 2 && !finalSections; attempt++) {
      try {
        const parsed = await llmSummarize(aggSections, dateStr);
        const v = validate(parsed, aggSections);
        if (v.length >= Math.min(3, aggSections.length)) finalSections = v;
        else log('第' + attempt + '次 LLM 输出校验未通过（板块过少），重试或降级');
      } catch (e) { log('LLM 调用失败（第' + attempt + '次）：', e.message); }
    }
  }
  if (finalSections) mode = 'LLM 摘要';
  else finalSections = rawFallback(aggSections);

  const data = { date: dateStr, sections: finalSections };
  const archive = updateArchive(dateStr);

  const js = '// 由 GitHub Actions 自动生成 ' + new Date().toISOString() + '\n'
    + '// 生成模式：' + mode + '\n'
    + 'window.BRIEFING_DATA = ' + JSON.stringify(data, null, 2) + ';\n\n'
    + 'window.BRIEFING_ARCHIVE = ' + JSON.stringify(archive) + ';\n';
  fs.writeFileSync(path.join(OUT_DIR, 'briefing-data.js'), js);
  writeMarkdown(dateStr, finalSections, mode, failures);

  // 供后续 step 使用的日期变量
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, 'BRIEF_DATE=' + dateStr + '\n');

  const stat = finalSections.map(s => s.title + ':' + s.items.length).join('，');
  log('✅ 完成：', stat, '｜模式：', mode);
})().catch(e => { console.error('[briefing] ❌ 失败：', e); process.exit(1); });
