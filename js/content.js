/* content.js — v2 内容表：武器进化、随机事件、阶段、掉落、新敌人 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var D = NS.DEFS;
  var C = NS.CONTENT = {};

  /* 武器进化：对应武器 LV5 + 指定被动 >=1 → 宝箱开出（短局降低门槛） */
  C.evolutions = [
    { weapon: 'pulse',   passive: 'proj',  name: '星轨歼灭炮', icon: '歼', color: '#8bf6ff', desc: '弹体翻倍，命中后分裂追击' },
    { weapon: 'orbit',   passive: 'haste', name: '永夜回环',   icon: '环', color: '#d4ff5c', desc: '光刃数量与转速大幅提升' },
    { weapon: 'laser',   passive: 'dmg',   name: '终焉光束',   icon: '终', color: '#ff77d0', desc: '双向贯穿光束，宽度与伤害翻倍' },
    { weapon: 'chain',   passive: 'crit',  name: '雷神之怒',   icon: '雷', color: '#fff36b', desc: '闪电额外跳跃 4 次且必定暴击' },
    { weapon: 'nova',    passive: 'hp',    name: '奇点坍缩',   icon: '坍', color: '#b9a8ff', desc: '冲击波范围扩大并牵引敌人' },
    { weapon: 'missile', passive: 'speed', name: '天基打击',   icon: '天', color: '#ffd87a', desc: '导弹齐射，爆炸范围与威力翻倍' }
  ];
  C.evoByWeapon = {};
  C.evolutions.forEach(function (e) { C.evoByWeapon[e.weapon] = e; });

  /* 随机事件：每 45 秒一次，持续约 20 秒 */
  C.events = [
    { id: 'swarm',     name: '数据洪流', text: '敌群密度激增 · 经验 +50%',   dur: 20, color: '#ff4d6d' },
    { id: 'crystal',   name: '晶体雨',   text: '大量经验晶体持续坠落',       dur: 18, color: '#22e6ff' },
    { id: 'elite',     name: '猎杀指令', text: '精英大量出没 · 必掉宝箱',     dur: 20, color: '#ffc44d' },
    { id: 'overclock', name: '超频领域', text: '攻速 +35% · 移速 +15%',       dur: 20, color: '#b6ff3c' },
    { id: 'storm',     name: '电磁风暴', text: '敌方弹幕加密 · 分数 x2',      dur: 18, color: '#a68bff' }
  ];

  /* 阶段配色按无尽层循环：C.stages[(floor-1) % length] */
  C.stages = [
    { name: '启动区',     sub: 'INIT',   bgTop: '#070b1a', bgBot: '#050811', grid: 'rgba(52,150,200,.075)',  accent: '#22e6ff', nebula: 'rgba(24,80,132,.17)' },
    { name: '光栅回廊',   sub: 'GRID',   bgTop: '#0b0a22', bgBot: '#08061a', grid: 'rgba(150,90,220,.10)',  accent: '#a68bff', nebula: 'rgba(90,40,150,.20)' },
    { name: '熔核地带',   sub: 'CORE',   bgTop: '#170b12', bgBot: '#0d0610', grid: 'rgba(255,120,80,.10)',  accent: '#ff7a3a', nebula: 'rgba(150,50,30,.20)' },
    { name: '深蓝静域',   sub: 'ABYSS',  bgTop: '#04131d', bgBot: '#030a12', grid: 'rgba(60,220,220,.10)',  accent: '#3affc0', nebula: 'rgba(20,120,120,.20)' },
    { name: '终焉协议',   sub: 'OMEGA',  bgTop: '#190616', bgBot: '#0a0410', grid: 'rgba(255,60,140,.12)',  accent: '#ff2f8e', nebula: 'rgba(160,20,100,.22)' }
  ];

  /* 宝箱奖励池 */
  C.loot = [
    { id: 'xp',     name: '经验洪流', color: '#22e6ff', weight: 3 },
    { id: 'heal',   name: '修复包',   color: '#7dffb0', weight: 2 },
    { id: 'magnet', name: '引力脉冲', color: '#a68bff', weight: 2 },
    { id: 'bomb',   name: '湮灭炸弹', color: '#ffc44d', weight: 2 },
    { id: 'energy', name: '能量注入', color: '#7df9ff', weight: 2 },
    { id: 'score',  name: '数据晶簇', color: '#ffe14d', weight: 2 },
    { id: 'weapon', name: '武器强化', color: '#ff8ad8', weight: 2 },
    { id: 'shield', name: '相位护盾', color: '#7fa8ff', weight: 1 }
  ];

  /* 地图上直接拾取的道具 */
  C.pickupDefs = {
    magnet: { name: '引力脉冲', color: '#a68bff', icon: '磁' },
    bomb:   { name: '湮灭炸弹', color: '#ffc44d', icon: '爆' },
    heal:   { name: '修复包',   color: '#7dffb0', icon: '修' },
    shield: { name: '相位护盾', color: '#7fa8ff', icon: '盾' }
  };

  /* 新增敌人 */
  D.enemies.charger = { r: 16, hp: 46,  speed: 88,  damage: 14, xp: 3, score: 40, color: '#ff7a3a', shape: 7 };
  D.enemies.bomber  = { r: 14, hp: 22,  speed: 122, damage: 0,  xp: 2, score: 30, color: '#ffd23a', shape: 8 };
  D.enemies.shield  = { r: 18, hp: 62,  speed: 58,  damage: 12, xp: 4, score: 55, color: '#5aa9ff', shape: 9 };
  D.evolutionReadyLevel = 5;
})(typeof window !== 'undefined' ? window : globalThis);
