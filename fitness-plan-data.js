// AI 健身计划数据桥接文件
// 由 WorkBuddy 自动化任务 "AI健身计划生成" 自动更新
// 工作站自动读取并导入到周计划中
window.FITNESS_PLAN_DATA = {
  generated: "2026-08-24",
  prompt: "通用模板（推拉腿+上下肢分化，中级训练者，每周 5-6 练）",
  plan: [
    {
      day: 0,
      dayName: "周一",
      focus: "推（胸/肩/三头）",
      exercises: [
        { name: "杠铃平板卧推", sets: "4×6-8", note: "主力动作，注意肩胛下沉" },
        { name: "上斜哑铃推举", sets: "3×8-10", note: "上胸重点" },
        { name: "站姿杠铃推举", sets: "3×8-10", note: "核心收紧，避免弓背" },
        { name: "哑铃侧平举", sets: "4×12-15", note: "中三角塑形" },
        { name: "绳索三头下压", sets: "3×12", note: "肘部夹紧身体" },
        { name: "俯卧撑（收尾）", sets: "2×力竭", note: "泵感收尾" }
      ]
    },
    {
      day: 1,
      dayName: "周二",
      focus: "拉（背/二头）",
      exercises: [
        { name: "引体向上（正握）", sets: "4×6-10", note: "无法完成可用高位下拉替代" },
        { name: "杠铃划船", sets: "4×8-10", note: "挺胸，膝盖微屈" },
        { name: "坐姿划船", sets: "3×10-12", note: "肩胛骨先动" },
        { name: "直臂下压", sets: "3×12", note: "背部宽度" },
        { name: "杠铃弯举", sets: "3×10", note: "肘部稳定" },
        { name: "锤式弯举", sets: "3×12", note: "肱肌和前臂" }
      ]
    },
    {
      day: 2,
      dayName: "周三",
      focus: "腿+核心",
      exercises: [
        { name: "杠铃深蹲", sets: "4×6-8", note: "膝盖方向同脚尖" },
        { name: "罗马尼亚硬拉", sets: "3×8-10", note: "腘绳肌和臀大肌" },
        { name: "腿举", sets: "3×10-12", note: "可加大重量" },
        { name: "腿弯举", sets: "3×12", note: "腘绳肌孤立" },
        { name: "站姿提踵", sets: "4×15-20", note: "小腿全程收缩" },
        { name: "卷腹/悬垂举腿", sets: "3×15", note: "核心稳定" }
      ]
    },
    {
      day: 3,
      dayName: "周四",
      focus: "推+上肢复合",
      exercises: [
        { name: "上斜杠铃卧推", sets: "4×8-10", note: "上胸强度" },
        { name: "哑铃推举（坐姿）", sets: "3×8-12", note: "肩部为主" },
        { name: "哑铃划船", sets: "3×10-12", note: "单侧背阔肌" },
        { name: "绳索夹胸", sets: "3×12-15", note: "胸部内侧线条" },
        { name: "面拉", sets: "3×15", note: "后束三角+肩袖" }
      ]
    },
    {
      day: 4,
      dayName: "周五",
      focus: "拉+下肢复合",
      exercises: [
        { name: "硬拉（传统/相扑）", sets: "4×5-6", note: "最大复合动作" },
        { name: "高脚杯深蹲", sets: "3×10-12", note: "前侧链激活" },
        { name: "弓步蹲（行走）", sets: "3×10/腿", note: "平衡和单侧力量" },
        { name: "引体向上（宽距）", sets: "3×8-10", note: "背部宽度" },
        { name: "二头弯举超级组", sets: "3×12", note: "充血收尾" }
      ]
    },
    {
      day: 5,
      dayName: "周六",
      focus: "有氧+弱点",
      exercises: [
        { name: "Zone 2 有氧（跑步/单车/划船）", sets: "30-40 分钟", note: "心率 130-150，可对话强度" },
        { name: "HIIT（可选）", sets: "15 分钟", note: "体能强者加做" },
        { name: "全身拉伸", sets: "15 分钟", note: "重点放松髋/胸/肩" }
      ]
    },
    {
      day: 6,
      dayName: "周日",
      focus: "休息",
      exercises: []
    }
  ]
};
