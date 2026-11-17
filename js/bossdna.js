/* bossdna.js — v12：首领形态程序化生成
 * 无限层要无限种形态：用层号做确定性哈希，生成一份「怪兽基因」，
 * 骨架族 / 体型 / 主副色相 / 眼数 / 牙数 / 腿数 / 节数 / 触手 / 角冠 / 斑纹 / 棘刺 全部由基因决定。
 * 同一层永远同一只（可复现、可测试），不同层几乎不可能撞脸。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};

  /* 32 位整数哈希（乘法散列 + 位混洗），保证 floor 不同 → 种子不同 */
  function hash32(n) {
    var x = (n | 0) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  }

  /* 以层号为种子的线性同余发生器：序列固定，不依赖 Math.random */
  function rngOf(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var NAME_A = ['数据吞噬者', '相位撕裂者', '零日核心', '深渊回响', '终焉协议',
    '熵增信徒', '量子溃疡', '黑箱先知', '熔断之眼', '静默蜂群'];
  var NAME_B = ['', '· 畸变', '· 增殖', '· 回响', '· 残响', '· 溃疡', '· 孢子', '· 断层'];

  /* 返回一只首领的完整基因（纯函数，同层恒定） */
  NS.bossDNA = function (f) {
    f = Math.max(1, f | 0);
    var seed = hash32(f * 2654435761);
    var rnd = rngOf(seed);

    var fam = (f - 1) % 4;                       /* 骨架族：0 巨口 / 1 多眼 / 2 蛛形 / 3 蛇形 */
    var hue = Math.round((f * 47 + 318) % 360);  /* 主色相逐层旋转，绝不追色 */

    var d = {
      f: f,
      fam: fam,
      gen: Math.floor((f - 1) / 4),
      hue: hue,
      hue2: Math.round((hue + 120 + (f % 5) * 24) % 360),
      scale: 0.92 + rnd() * 0.34,                /* 体型 0.92~1.26 */
      eyes: 1 + Math.floor(rnd() * 8),           /* 1~8 只眼 */
      teeth: 3 + Math.floor(rnd() * 7),          /* 3~9 颗獠牙 */
      legs: 6 + Math.floor(rnd() * 8),           /* 6~13 条节肢（偶数化） */
      segs: 4 + Math.floor(rnd() * 5),           /* 4~8 节躯干 */
      tendrils: 4 + Math.floor(rnd() * 7),       /* 4~10 条触须 */
      horns: Math.floor(rnd() * 4),              /* 0~3 支角冠 */
      spots: Math.floor(rnd() * 4),              /* 0~3 组斑纹 */
      rings: 1 + Math.floor(rnd() * 2),          /* 1~2 层符文环 */
      spikes: 4 + Math.floor(rnd() * 9),         /* 4~12 根外棘刺 */
      jaw: 0.55 + rnd() * 0.75,                  /* 张口幅度系数 */
      tilt: (rnd() - 0.5) * 0.30,                /* 身体倾斜 */
      wob: 0.6 + rnd() * 1.2                     /* 抖动频率 */
    };
    if (d.legs % 2) d.legs++;                    /* 蛛形腿成对 */
    d.color = 'hsl(' + d.hue + ',88%,58%)';
    d.color2 = 'hsl(' + d.hue2 + ',92%,64%)';
    d.dark = 'hsl(' + d.hue + ',70%,7%)';
    d.bone = 'hsl(' + d.hue + ',42%,93%)';
    return d;
  };

  /* 名字：前缀按层号遍历（10 个一轮），后缀每 10 层换一档 → 80 层内不重名 */
  NS.bossName = function (f) {
    f = Math.max(1, f | 0);
    var a = NAME_A[f % NAME_A.length];
    var b = NAME_B[Math.floor(f / NAME_A.length) % NAME_B.length];
    return a + b;
  };
})(typeof window !== 'undefined' ? window : globalThis);
