// ทดสอบ circuit-lab.html ด้วย Playwright (Node)
// ใช้: node tests/circuit-lab.test.js   (ต้องติดตั้ง playwright; ถ้าติดตั้งแบบ global ให้ตั้ง NODE_PATH=$(npm root -g))
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto('file://' + path.resolve(__dirname, '..', 'circuit-lab.html'));

  const r = await page.evaluate(() => {
    const s = window.__sim, o = {};
    const I = n => s.RES.comp[s.find(n).id].Ir;
    s.load('series');   o.series = I('B1');
    s.load('parallel'); o.parallel = I('B1');
    s.load('mixed');    o.mixed = I('B1');
    s.load('led');      o.led = I('D1');

    s.load('dol');
    const start = s.find('START'), m = s.find('M1');
    start._pr = true; s.poke(); start._pr = false; s.poke();
    o.dolCoil = s.find('K1')._on;
    o.dolInrush = s.RES.comp[m.id].ph[0];
    s.run(6);
    o.dolI = s.RES.comp[m.id].ph;
    s.find('F2').on = false; s.poke();
    o.dolHum = m._hum;

    for (const mode of ['lad', 'txt']){
      s.load('plcpump');
      const plc = s.find('PLC1'), tk = s.find('TK1');
      plc.prog.mode = mode; delete plc._cp;
      s.run(0.2);
      const b = s.find('START'); b._pr = true; s.poke(); s.run(0.2); b._pr = false; s.poke();
      const ev = []; let q = plc._img.Q[0];
      for (let t = 0; t < 60; t += 0.05){ s.step(0.05); if (plc._img.Q[0] !== q){ q = plc._img.Q[0]; ev.push([q, tk.lvl]); } }
      o['pump_' + mode] = ev;
      o['hmi_' + mode] = !!s.find('HMI1')._link;
    }
    s.load('arduino'); s.run(1.2);
    o.ardA0 = +/A0 = (\d+)/.exec(s.find('U1')._vm.serial)[1];
    o.ardLed = I('D1');
    s.find('RV1').pos = 10; s.poke(); s.run(0.6);
    o.ardLedDim = I('D1');

    s.load('esp32'); s.run(0.5);
    const btn = s.find('S1'); btn._pr = true; s.poke(); s.run(0.2); btn._pr = false; s.poke(); s.run(0.2);
    o.espLed = !!s.find('D1')._on; o.espSerial = s.find('U1')._vm.serial;

    s.load('pico'); s.run(0.5);
    o.picoRed = !!s.find('D1')._on; o.picoRedI = I('D1');
    s.run(3.2); o.picoGreen = !!s.find('D3')._on && !s.find('D1')._on;
    s.load('ardsense'); s.run(1.1);
    o.senseLine = s.find('U1')._vm.serial.split('\n')[0];
    s.find('US1').dist = 10; s.find('PIR1')._t = 3; s.poke(); s.run(1.0);
    o.senseBz = !!s.find('BZ1')._snd; o.sensePir = /PIR=1/.test(s.find('U1')._vm.serial);

    s.load('espgarden'); s.run(1.5); o.servoDry = s.find('SV1')._ang;
    s.find('SM1').moist = 70; s.poke(); s.run(1.5); o.servoWet = s.find('SV1')._ang;

    s.load('plcsense'); s.run(0.3);
    const pl = s.find('PLC1');
    o.ai0 = pl._img.AI[0]; o.q0off = pl._img.Q[0];
    s.find('PX1').det = true; s.poke(); s.run(0.1); o.q0on = pl._img.Q[0];
    s.find('SQ1').act = true; s.poke(); s.run(0.1); o.q0lim = pl._img.Q[0];
    s.find('TT1').pct = 90; s.poke(); s.run(0.1); o.q2 = pl._img.Q[2];

    const RC = n => s.RES.comp[s.find(n).id];
    s.load('semi'); s.run(0.1);
    o.reg = RC('U1').vout; o.vz = RC('V1').Vr; o.ledOff = RC('D1').Ir;
    s.find('S1').on = true; s.poke(); s.run(0.1);
    o.ledOn = RC('D1').Ir; o.qState = s.find('Q1')._bj;

    s.load('timer555'); s.run(0.2);
    let tr = 0, lq = s.find('U1')._q;
    for (let t = 0; t < 4; t += 0.05){ s.step(0.05); if (s.find('U1')._q !== lq){ tr++; lq = s.find('U1')._q; } }
    o.t555 = tr;

    s.load('counter'); s.run(1.5);
    o.seg = 'abcdefg'.split('').filter((_, k) => s.find('DS1')._js[k]).join('');

    s.load('motor'); s.run(0.3); o.motorOff = RC('M1').Ir;
    const mb = s.find('S1'); mb._pr = true; s.poke(); s.run(0.2); mb._pr = false; s.poke(); s.run(0.5);
    o.motorOn = RC('M1').Ir; s.run(4); o.motorRun = RC('M1').Ir;

    const src = () => s.RES.src[s.S.comps.find(c => c.t === 'src3' || c.t === 'src1').id];
    s.load('stardelta'); s.run(0.5);
    const sb = s.find('START'); sb._pr = true; s.poke(); s.run(0.3); sb._pr = false; s.poke();
    o.sdInrush = src().I; s.run(2.5);
    const m6 = s.find('M1'); o.sdStar = [m6._cn, s.find('K2')._on, +src().I.toFixed(2)];
    s.run(4); o.sdDelta = [m6._cn, !!s.find('K3')._on, !!s.find('K2')._on, +src().I.toFixed(2)];
    s.find('F2').on = false; s.poke(); o.sdHum = m6._hum; s.run(15);
    o.sdProt = !!s.find('F4')._trip || !s.find('F1').on || !s.find('F3').on;
    s.load('stardelta'); s.run(0.3); const sb2 = s.find('START'); sb2._pr = true; s.poke(); s.run(0.3); sb2._pr = false; s.poke(); s.run(1);
    s.find('S0').act = true; s.poke(); s.run(0.2); o.estop = !!s.find('K1')._on;

    s.load('rcdtest'); s.run(0.3); o.rcd0 = s.find('RCD1').on;
    s.find('แตะสายไฟ').on = true; s.poke(); s.run(0.1); o.rcd1 = [s.find('RCD1').on, s.find('RCD1')._trip, RC('คน').Ir];

    s.load('pfc'); s.run(3);
    const pf = () => { const x = RC('PM1'); return [Math.abs(x.P)/Math.hypot(x.P, x.Q), x.I]; };
    o.pf0 = pf(); s.find('S1').on = true; s.poke(); s.run(0.2); o.pf1 = pf();

    s.load('stair'); s.run(0.1); const lit = () => RC('H1').Ir > 0.1; o.stair = [lit()];
    s.find('S1').pos = 'B'; s.poke(); o.stair.push(lit()); s.find('S2').pos = 'X'; s.poke(); o.stair.push(lit()); s.find('S3').pos = 'B'; s.poke(); o.stair.push(lit());

    s.load('factory'); s.run(0.5);
    o.facIdle = s.find('M1')._sp || 0;
    const fs = s.find('START'); fs._pr = true; s.poke(); s.run(0.3); fs._pr = false; s.poke(); s.run(60);
    o.facCnt = Object.assign({}, s.FXS.cnt); o.facConv = s.find('M1')._sp;
    const fp = s.find('STOP'); fp._pr = true; s.poke(); s.run(0.3); fp._pr = false; s.poke(); s.run(8);
    o.facStop = s.find('M1')._sp; o.facGl = !!document.querySelector('#fx').getContext('webgl');

    const press = (n, t) => { const c = s.find(n); c._pr = true; s.poke(); s.run(t || 0.3); c._pr = false; s.poke(); };
    s.load('seqconv'); s.run(0.5); press('START'); s.run(1); o.seq1 = [!!s.find('M2')._run, !!s.find('M1')._run];
    s.run(4); o.seq2 = [!!s.find('M2')._run, !!s.find('M1')._run]; s.run(40); o.seqCnt = Object.assign({}, s.FXS.cnt);
    press('STOP'); s.run(1); o.seq3 = [!!s.find('K2')._on, !!s.find('K1')._on]; s.run(5); o.seq4 = [!!s.find('K2')._on, !!s.find('K1')._on];

    s.load('gate'); s.run(0.5); const gp = () => s.FXS.rt[1].p;
    o.gate0 = [gp(), s.find('SQ2').act]; press('OPEN'); s.run(9); o.gate1 = [gp(), !!s.find('K1')._on, s.find('SQ1').act];
    press('CLOSE'); s.run(2); press('STOP'); s.run(1); const mid = gp(); s.run(2); o.gate2 = [mid, gp(), !!s.find('K2')._on];
    press('CLOSE'); s.run(9); o.gate3 = [gp(), !!s.find('K2')._on, s.find('SQ2').act];

    s.load('plcpump'); o.tankScene = s.S.fac.items.map(i => i.k).join();
    // จัดวางเอง: ฉากว่าง + สายพาน + ตัวปล่อย + ถัง ผูกกับมอเตอร์ M1 ของตัวอย่าง factory
    s.load('factory'); s.S.fac = {btn:['START','STOP'], items:[
      {id:1, k:'conv', x:1.5, z:0, r:0, len:3, spd:0.5, m:'M1'}, {id:2, k:'emit', x:0.3, z:0, r:0, every:2, metal:0}, {id:3, k:'bin', x:3.55, z:0, r:0, want:'any'}]};
    s.FXS.boxes.length = 0; s.run(0.3); press('START'); s.run(30); o.custom = Object.assign({}, s.FXS.cnt); o.customSaved = JSON.parse(JSON.stringify(s.S.fac.items.length));

    s.load('pickplace'); s.run(0.5); press('START'); s.run(60); o.pick = Object.assign({}, s.FXS.cnt);
    // ตัวกั้นชิ้นงาน: คอยล์ Y1 ไม่มีไฟ → กั้น, มีไฟ → เปิดทาง
    s.load('factory'); s.S.fac = {btn:['START','STOP'], items:[
      {id:1, k:'conv', x:2, z:0, r:0, len:4, spd:0.5, m:'M1'}, {id:2, k:'emit', x:0.3, z:0, r:0, every:2, metal:0}, {id:3, k:'stop', x:3, z:0, r:0, y:'K1'}, {id:4, k:'bin', x:4.55, z:0, r:0, want:'any'}]};
    s.S.fac.items[2].y = 'Y1'; s.run(0.3); press('START'); s.run(20); o.stopHeld = [s.FXS.cnt.other, s.FXS.boxes.length];
    s.S.fac.items[2].y = 'K1'; s.run(15); o.stopOpen = s.FXS.cnt.other;
    s.load('dol'); o.dolScene = s.S.fac.items.map(i => i.k).join(); press('START'); s.run(4); o.fanTurns = s.FXS.rt[1].ang > 10;
    s.load('pico'); s.run(1); o.traffic = [s.flit('D1'), s.flit('D3')]; s.run(3.2); o.traffic2 = [s.flit('D1'), s.flit('D3')];

    s.load('lift'); s.run(0.5); o.liftSq = [s.find('SQ1').act, s.find('SQ2').act]; press('START');
    let liftTop = 0, liftMaxY = 0;
    for (let t = 0; t < 120; t += 0.05){ s.step(0.05); if (s.FXS.rt[3].p >= 0.995) liftTop++; for (const bx of s.FXS.boxes) liftMaxY = Math.max(liftMaxY, bx.y); }
    o.lift = Object.assign({}, s.FXS.cnt); o.liftTop = liftTop; o.liftMaxY = liftMaxY;
    // หลายระดับ: กล่องตกจากสายพานสูง 1.6 m ลงสายพานลาดเอียงด้านล่าง (0.6 → 1.2 m) แล้วลงถัง
    s.load('factory'); s.S.fac = {btn:['START','STOP'], items:[
      {id:1, k:'conv', x:1.5, z:0, r:0, len:3, spd:0.5, m:'M1', h:1.6, h2:1.6}, {id:2, k:'emit', x:0.3, z:0, r:0, every:2, metal:0, h:1.6},
      {id:3, k:'conv', x:4.4, z:0, r:0, len:3, spd:0.5, m:'M1', h:0.6, h2:1.2}, {id:4, k:'bin', x:6.45, z:0, r:0, want:'any'}]};
    s.run(0.3); press('START'); s.run(40); o.cascade = Object.assign({}, s.FXS.cnt);

    // ออสซิลโลสโคป
    s.load('osc'); s.run(0.5);
    let cap = s.scope('OSC1'); const sch = k => cap.ch[k];
    o.osc = [sch(0).max - sch(0).min, sch(0).rms, sch(0).f, sch(1).max, sch(1).min, sch(1).f, sch(1).duty, cap.trig];
    const sc = s.find('OSC1'); sc.cpl2 = 'AC'; cap = s.scope('OSC1'); o.oscAC = Math.abs(cap.ch[1].avg); sc.cpl2 = 'DC';
    s.scopeAutoset('OSC1'); o.oscAuto = [sc.vdiv1, sc.vdiv2, sc.tdiv, sc.trig];
    s.find('U1').C = 100; s.poke(); sc.tdiv = 0.5; sc._hist = []; s.run(6); cap = s.scope('OSC1');
    o.oscRoll = [cap.roll, cap.ch[1].f, cap.ch[0].max - cap.ch[0].min];
    // FFT: CH1 ไซน์ 50 Hz, CH2 คลื่นสี่เหลี่ยม NE555 (ฮาร์มอนิกตามอนุกรมฟูเรียร์)
    s.load('osc'); s.run(0.5); const fsc = s.find('OSC1'); fsc.disp = 'fft'; fsc.fftch = '1';
    let F = s.scope('OSC1').fft; o.fft1 = [F.fund.f, F.fund.v, F.peaks.length, F.thd];
    fsc.fftch = '2'; F = s.scope('OSC1').fft; const hv = h => (F.peaks.find(p => p.h === h) || {v:0}).v;
    o.fft2 = [F.fund.f, F.fund.v, hv(3), hv(5), F.dc, F.span];
    // XY: วงจร RC → ผลต่างเฟส −atan(ωRC) ≈ −46°
    s.load('oscxy'); s.run(0.3); const xc = s.scope('OSC1'); o.xy = [xc.phase, xc.xy ? xc.xy[0].length : 0];
    // Math CH1−CH2 = แรงดันคร่อม R ≈ 8.64 Vrms (Vpp ≈ 24.4 V) ทั้งโหมดเร็ว/FFT/เลื่อน
    { const c = s.S.comps.find(x => x.n === 'OSC1'); c.disp = 'yt'; c.math = 'sub'; const m = s.scope('OSC1').ch[2];
      c.disp = 'fft'; c.fftch = 'M'; const fp = s.scope('OSC1').fft.peaks[0]; c.disp = 'yt'; c.tdiv = 0.5; s.run(1.5); const rm = s.scope('OSC1').ch[2];
      o.math = [m.max - m.min, m.rms, m.f, fp.f, fp.v, rm.max - rm.min]; }
    // เคอร์เซอร์: เวลา 2→6 div ที่ 5 ms/div = 20 ms (50 Hz); แรงดัน CH2 (5 V/div, ตำแหน่ง −3) A=2, B=−2 div → 25 V, 5 V
    { s.load('osc'); s.run(0.3); const c = s.S.comps.find(x => x.t === 'scope'); c.cur = 'time'; c.ta = 2; c.tb = 6; s.scope(c.n); const t = s.scopeCursor(c.n);
      c.cur = 'volt'; c.cch = '2'; c.va = 2; c.vb = -2; const v = s.scopeCursor(c.n); o.cur = [t.dt, t.inv, v.vA, v.vB, v.dv]; }
    // ลิฟต์โดยสาร 3 ชั้น (แลดเดอร์และข้อความ): เรียกชั้น 3 แล้วเรียกชั้น 2 ระหว่างทาง → จอดชั้น 2 (ประตูเปิด) → ไปชั้น 3; เรียกชั้น 1 → ลงจอดชั้น 1
    for (const md of ['lad', 'txt']){ s.load('elevator'); const plc = s.find('PLC1'); plc.prog.mode = md; delete plc._cp;
      const it = s.S.fac.items.find(i => i.k === 'elev'), P = () => s.FXS.rt[it.id].p, press = n => { const c = s.find(n); c._pr = true; s.poke(); s.run(0.2); c._pr = false; s.poke(); };
      const H1 = () => s.RES.comp[s.find('H1').id].Ir > 0.01;
      s.run(0.5); const e = [s.find('SQ1').act]; press('F3'); s.run(2.5); press('F2'); s.run(1.5);
      e.push(P(), s.find('SQ2').act, H1(), !s.find('KU')._on); s.run(8); e.push(P(), s.find('SQ3').act);
      press('F1'); s.run(12); e.push(P(), s.find('SQ1').act, !s.find('KD')._on);
      o['elev_' + md] = e; }
    // เซนเซอร์อุตสาหกรรม (indsense) ทั้งแลดเดอร์และข้อความ: หลอด H1–H4 = ปั๊ม, เตือน, ฮีตเตอร์, พร้อมป้อน
    for (const md of ['lad', 'txt']){ s.load('indsense'); const plc = s.find('PLC1'); plc.prog.mode = md; delete plc._cp; s.run(0.5);
      const L = () => ['H1','H2','H3','H4'].map(n => s.RES.comp[s.find(n).id].Ir > 0.02 ? 1 : 0).join(''), set = (n, k, v) => { s.find(n)[k] = v; s.solveNow(); s.run(0.3); return L(); };
      const e = [L()];
      e.push(set('BF1', 'pv', 0)); s.run(3.5); e.push(L()); set('BF1', 'pv', 3);                     // ไม่มีน้ำไหล → เตือนหลัง 3 s
      e.push(set('BP1', 'pv', 3), set('BP1', 'pv', 2), set('BP1', 'pv', 1.3));                        // ตัด 2.8 bar, ค้าง (ดิฟ), ต่อ 1.4 bar
      e.push(set('LC1', 'det', true)); set('LC1', 'det', false);                                        // บังม่านแสง → หยุดทุกอย่าง + เตือน
      e.push(set('GD1', 'lel', 30)); set('GD1', 'lel', 0);
      e.push(set('UB1', 'dist', 50)); set('UB1', 'dist', 150);
      e.push(set('BT1', 'pv', 70), set('CX1', 'det', true));
      o['ind_' + md] = e; }
    // สื่อสาร RS-485 / LoRa / RS-232
    { s.load('rs485'); s.run(3); const u2 = s.find('U2'), D = () => s.RES.comp[s.find('D1').id].Ir;
      const e = [u2._vm.err, /รับ P=60\n$/.test(u2._vm.serial), D()];
      s.find('RV1').pos = 20; s.solveNow(); s.run(2); e.push(/รับ P=20\n$/.test(u2._vm.serial), D());
      u2.code = u2.code.replace('rs485.begin(9600)', 'rs485.begin(4800)'); mcuBoot(u2); s.run(2); e.push(/รับ/.test(u2._vm.serial));          // บอดไม่ตรง → อ่านไม่ออก
      o.c485 = e; }
    { s.load('lora'); s.run(5); const u2 = s.find('U2'), rf = s.find('RF2');
      const e = [/ได้รับ: TEMP=\d+;N=3\n$/.test(u2._vm.serial), rf._link.ok, Math.round(rf._link.rssi)];
      rf.loc = 9000; const n0 = u2._vm.serial.length; s.run(4); e.push(u2._vm.serial.length === n0, rf._link.ok);
      s.find('RF1').sf = 12; rf.sf = 12; s.run(4); e.push(u2._vm.serial.length > n0, rf._link.ok);
      o.clora = e; }
    { s.load('rs232'); s.run(2.5); const pc = s.find('PC1'), u1 = s.find('U1'), L = () => u1._vm.pins[13] ? u1._vm.pins[13].v : 0;
      const e = [/Arduino พร้อม/.test(pc._log)]; termSend(pc, 'on'); s.run(0.5); e.push(L(), /LED ติด\n$/.test(pc._log));
      termSend(pc, 'OFF'); s.run(0.5); e.push(L()); pc.baud = 2400; termSend(pc, 'ON'); s.run(0.5); e.push(L());
      o.c232 = e; }
    // Modbus RTU: PLC มาสเตอร์ ↔ Arduino สเลฟ (แลดเดอร์และข้อความ)
    for (const md of ['lad', 'txt']){ s.load('modbus'); const plc = s.find('PLC1'); plc.prog.mode = md; delete plc._cp; s.run(2);
      const u = s.find('U1'), L = n => s.RES.comp[s.find(n).id].Ir, im = plc._img;
      const e = [im.D[0], im.D[8], L('H1') > 0.04, L('D37') > 0.005, L('D34')];
      s.find('RV1').pos = 30; s.solveNow(); s.run(1.5); e.push(im.D[0], L('H1') < 0.001, L('D37') < 0.001, L('D34') < e[4]);
      const S1 = s.find('S1'); S1._pr = true; s.poke(); s.run(1); e.push(L('D40') > 0.005); S1._pr = false; s.poke();
      u.code = u.code.replace('modbus.begin(1, 9600)', 'modbus.begin(1, 4800)'); mcuBoot(u); s.run(0.5); const ok0 = plc._mb.ok; s.run(1.5);
      e.push(plc._mb.ok === ok0, u._vm.mb.err > 0, /timeout/.test(plc._mb.lastErr));
      o['mb_' + md] = e.map(v => typeof v === 'number' ? +v.toFixed(4) : v); }
    { const im = newImage(); const c = compile('D3 := (AI0 + 10) * 2 - D1 / 4\nQ0 := D3 >= 60'); im.AI[0] = 25; im.D[1] = 40; runText(c.code, im, 0.1); o.mbexpr = [c.err.length, im.D[3], im.Q[0]]; }
    { const f = mbFrame([1, 3, 0, 0, 0, 1]); o.crc = mbHex(f); }
    // HMI ↔ PLC ผ่าน Modbus RTU (PLC = สเลฟ): ปุ่ม START/STOP บน HMI, ไฟอ่านกลับ, ค่า D บนจอ, ID ผิด → timeout
    for (const md of ['lad', 'txt']){ s.load('hmimodbus'); const plc = s.find('PLC1'), h = s.find('HMI1'); plc.prog.mode = md; delete plc._cp;
      h.l4 = 'D5 ค่า'; plc._img = plc._img || newImage(); s.run(1); plc._img.D[5] = 1234; s.run(1);
      const e = [h._mb.ok > 3, h._mbv.I2, h._mbv.D5];
      h._press = 0; s.run(0.4); h._press = null; s.run(0.6); e.push(plc._img.M[2], h._mbv.M2);
      h._press = 1; s.run(0.4); h._press = null; s.run(0.6); e.push(plc._img.M[2], h._mbv.M2);
      h.sid = 2; s.run(1.5); e.push(/timeout/.test(h._mb.lastErr), warnList().some(w => /Modbus ไม่ได้รับคำตอบ/.test(w[1])));
      o['hmb_' + md] = e; }
    { const p = {_img:newImage()}; const R = mbServe([1, 1, 0, 40, 0, 1], plcMbTables(p)), R2 = mbServe([1, 6, 0, 3, 0x01, 0xF4], plcMbTables(p)); o.mbex = [R.ex, R.r[1], R2.ex, p._img.D[3]]; }
    // PLC 2 พอร์ต: #1 มาสเตอร์ → Arduino, #2 สเลฟ ← HMI (ID 2, 19200) พร้อมกัน
    for (const md of ['lad', 'txt']){ s.load('plc2port'); const plc = s.find('PLC1'), h = s.find('HMI1'); plc.prog.mode = md; delete plc._cp; s.run(2);
      const L = n => s.RES.comp[s.find(n).id].Ir;
      const e = [plc._img.D[0], plc._mb.ok > 5, plc._p2._mbs.rx > 5, h._mbv.D0, h._mbv.Q0];
      h._press = 0; s.run(1); e.push(plc._img.M[17], L('D40') > 0.005); h._press = null; s.run(1); e.push(L('D40') < 0.001);
      s.find('RV1').pos = 30; s.solveNow(); s.run(1.5); e.push(h._mbv.D0, h._mbv.Q0);
      plc.mb2Baud = 9600; s.run(1.5); e.push(/timeout/.test(h._mb.lastErr), plc._mb.lastErr === '');
      o['p2_' + md] = e; }
    // Modbus TCP ผ่าน Ethernet: PLC1 ไคลเอนต์ ↔ PLC2 เซิร์ฟเวอร์, HMI → PLC1, ซับเน็ตผิด, IP ซ้ำ, ถอดสวิตช์
    for (const md of ['lad', 'txt']){ s.load('modbustcp'); const p1 = s.find('PLC1'), p2 = s.find('PLC2'), h = s.find('HMI1'), S1 = s.find('S1');
      p1.prog.mode = md; delete p1._cp; const L = n => s.RES.comp[s.find(n).id].Ir > 0.02 ? 1 : 0;
      S1.on = false; s.solveNow(); s.run(2); const e = [L('H1'), p1._img.D[0] > 10 && Math.abs(p1._img.D[0] - p2._img.D[0]) < 20, h._mbv.D0 > 10];
      S1.on = true; s.solveNow(); s.run(1); e.push(L('H1'), h._mbv.M0);
      h._press = 0; s.run(1); e.push(p2._img.M[5], L('H2')); h._press = null; s.run(1); e.push(L('H2'));
      h.ip = '192.168.2.50'; s.run(1.5); e.push(/ซับเน็ต/.test(h._mb.lastErr)); h.ip = '192.168.1.50';
      p2.ip = '192.168.1.10'; s.solveNow(); e.push(warnList().some(w => /IP conflict/.test(w[1]))); p2.ip = '192.168.1.20';
      s.S.comps = s.S.comps.filter(c => c.t !== 'ethsw'); s.solveNow(); s.run(1.5); e.push(/ไม่มีลิงก์/.test(p1._p3._mb.lastErr));
      o['tcp_' + md] = e; }
    { const a = tcpAdu(7, mbBytes(mbFrame([1, 3, 0, 0, 0, 4]))); o.mbap = hexB(a); }
    // แรงดันบัส RS-485: ว่าง (ไบแอส 680 Ω) ≈ 0.21 V, ขณะส่ง ≈ 2.8 V, แต่ละเส้นเทียบ GND ≈ 2.5 V
    { s.load('rs485'); s.run(1); const m = s.find('MD2'), V = () => { const p = s.RES.comp[m.id].pv; return [p[6].d - p[5].d, p[6].d - p[7].d]; }; let idle = null, tx = null;
      for (let i = 0; i < 30; i++){ s.step(0.05); const v = V(); if (s.find('MD1')._drv) tx = v; else idle = v; }
      o.busV = [idle, tx].map(v => v && v.map(x => +x.toFixed(2))); }
    // ESP32 Wi-Fi + Modbus TCP: ต่อ AP ได้ IP, pot → D10, ปุ่ม → M5, อ่าน Q0 → LED, ออกนอกระยะ → หลุด แล้วต่อใหม่เอง, รหัสผิด
    for (const md of ['txt', 'lad']){ s.load('esp32wifi'); const u = s.find('U1'), plc = s.find('PLC1'), L = n => s.RES.comp[s.find(n).id].Ir > 0.02 ? 1 : 0;
      plc.prog.mode = md; delete plc._cp; s.run(4);
      const e = [u._vm.err, /ได้ IP 192\.168\.1\.\d+  RSSI -55/.test(u._vm.serial), Math.abs(plc._img.D[10] - 1228) < 5, L('H1')];
      s.find('RV1').pos = 90; s.solveNow(); s.run(1.5); e.push(plc._img.D[10] > 3000, L('H1'), u._vm.pins[2].v);
      s.find('RV1').pos = 30; s.solveNow(); const S1 = s.find('S1'); S1._pr = true; s.poke(); s.run(1.2); e.push(plc._img.M[5], L('H1')); S1._pr = false; s.poke(); s.run(1.2); e.push(L('H1'));
      u.wdist = 500; s.run(2); e.push(u._vm.wifi.st, /ยังไม่ได้ต่อ Wi-Fi/.test(u._vm.serial.slice(-80))); u.wdist = 15; s.run(6); e.push(u._vm.wifi.st, u._vm.mbtcp.on);
      if (md === 'txt'){ s.find('AP1').pass = 'wrong'; mcuBoot(u); s.run(3); e.push(u._vm.wifi.st, u._vm.wifi.why); }
      o['wifi_' + md] = e; }
    // สโคปจับเฟรม UART บนบัส RS-485: ต่อโพรบ A/B → ถอดรหัส "P=60⏎", A และ B กลับขั้วกัน, Auto Set → 1 ms/div
    { const ob = EX.rs485.f(); ob.raw = true;
      ob.comps.push(Object.assign(mkComp('scope', 30, 18, {n:'OSCB', tdiv:0.001, vdiv1:2, vdiv2:2, pos1:0, pos2:-3, tmode:'norm'}), {id:ob.nid++}));
      ob.wires.push({x1:29, y1:20, x2:29, y2:12}, {x1:30, y1:20, x2:30, y2:14}, {x1:32, y1:20, x2:32, y2:22}, {x1:32, y1:22, x2:55, y2:22}, {x1:55, y1:22, x2:55, y2:9}, {x1:55, y1:9, x2:52, y2:9});
      s.load(ob); s.run(1.2); let cap = null; for (let i = 0; i < 12 && !(cap && cap.uart); i++){ s.step(0.05); cap = s.scope('OSCB'); }
      const sc = s.find('OSCB'); const e = cap && cap.uart ? [cap.uart.text, cap.uart.hex, +(1/cap.uart.baud*1e6).toFixed(0), cap.ch[0].max > 3.5 && cap.ch[0].min < 1.5, cap.ch[1].max > 3.5 && cap.ch[1].min < 1.5] : [null];
      // A กับ B ตรงข้ามกันทุกคอลัมน์
      if (cap && cap.uart){ let opp = 0; for (let i = 0; i < SC_COLS; i++) if ((cap.ch[0].vc[i] > 2.5) !== (cap.ch[1].vc[i] > 2.5)) opp++; e.push(opp > SC_COLS*0.95); }
      sc.tdiv = 0.01; scopeAutoset(sc); e.push(sc.tdiv); o.sbus = e; }
    // โพรบ ×1/×10: ตัวแบ่ง 1 MΩ/1 MΩ จาก 10 V → ×1 (1 MΩ ขนาน) 3.33 V, ×10 (10 MΩ ขนาน) 4.76 V
    // Single: รอทริก (จอว่าง) → กด S1 → จับขั้นบันไดที่ 1 ช่องแล้ว STOP; Normal ในโหมดเลื่อนค้างพัลส์ไว้
    { s.load('oscprobe'); s.run(0.2); const c = s.find('OSC1'), S1 = s.find('S1'); let cp = s.scope('OSC1'); const w0 = [cp.blank, c.run];
      S1._pr = true; s.poke(); s.run(0.2); cp = s.scope('OSC1');
      o.probe = [w0[0], w0[1], cp.trig, c.run, cp.ch[0].vc[200], cp.ch[1].vc[30], cp.ch[1].vc[200]];
      S1._pr = false; s.poke(); c.tmode = 'norm'; c.tdiv = 0.2; c._hist = []; s.scopeArm('OSC1'); s.run(1);
      S1._pr = true; s.poke(); s.run(0.5); S1._pr = false; s.poke(); s.run(2.5); cp = s.scope('OSC1');
      o.norm = [cp.trig, cp.ch[1].mx[30], cp.ch[1].mx[90], cp.ch[1].mx[400]];
      s.load('osc'); s.find('T1').V2 = 230; s.find('T1').S = 2000; s.solveNow(); const wa = warnList().some(x => x[1].includes('เกินพิกัดโพรบ ×1'));
      s.find('OSC1').px1 = 10; s.solveNow(); o.prwarn = [wa, warnList().some(x => x[1].includes('เกินพิกัดโพรบ'))]; }
    s.load('arduino'); s.run(1.2); o.pwmSw = scopeSwitchers().map(x => [x.f, Math.round(x.duty*100)/100]);

    o.mcuErr = ['arduino','esp32','pico','ardsense','espgarden','counter','motor'].map(k => (s.load(k), s.run(0.3), s.find('U1')._vm.err)).filter(Boolean);
    return o;
  });

  const checks = [];
  const near = (name, v, want, tol) => checks.push([name, Math.abs(v - want) <= tol, v]);
  near('series 0.25 A', r.series, 0.25, 0.002);
  near('parallel 1.5 A', r.parallel, 1.5, 0.01);
  near('mixed 54.5 mA', r.mixed, 0.0545, 0.0005);
  near('led 21 mA', r.led, 0.021, 0.0005);
  checks.push(['dol: K1 ดูด', r.dolCoil === true, r.dolCoil]);
  near('dol: กระแสสตาร์ท ≈ 6 × In (15.3 A)', r.dolInrush, 15.3, 0.2);
  for (let k = 0; k < 3; k++) near('dol: กระแสเฟส ' + (k + 1) + ' หลังเร่งเครื่อง 2.55 A', r.dolI[k], 2.55, 0.02);
  checks.push(['dol: ขาดเฟส → _hum', r.dolHum === true, r.dolHum]);
  for (const mode of ['lad', 'txt']){
    const ev = r['pump_' + mode];
    checks.push([`plcpump (${mode}): ปั๊มเริ่มต่ำกว่า 30% และหยุดที่ 90%`,
      ev.length >= 2 && ev[0][0] === 1 && ev[0][1] < 30 && ev[0][1] > 28 && ev[1][0] === 0 && ev[1][1] >= 90 && ev[1][1] < 91, JSON.stringify(ev)]);
    checks.push([`plcpump (${mode}): HMI เชื่อมต่อ PLC`, r['hmi_' + mode], r['hmi_' + mode]]);
  }
  near('arduino: pot 70% → A0 ≈ 716', r.ardA0, 716, 2);
  checks.push(['arduino: LED หรี่ลงเมื่อหมุน pot ลง', r.ardLed > 0.008 && r.ardLedDim > 0 && r.ardLedDim < r.ardLed, r.ardLed.toFixed(4) + ' → ' + r.ardLedDim.toFixed(4)]);
  checks.push(['esp32: กดปุ่ม 1 ครั้ง → LED ติด, นับ 1 ครั้ง', r.espLed && (r.espSerial.match(/กดครั้งที่/g) || []).length === 1, JSON.stringify(r.espSerial)]);
  checks.push(['pico: ไฟแดงติดก่อน (≈3.5 mA) แล้วเปลี่ยนเป็นเขียว', r.picoRed && Math.abs(r.picoRedI - 0.0035) < 0.0003 && r.picoGreen, r.picoRedI]);
  checks.push(['โค้ดตัวอย่างไมโครคอนโทรลเลอร์ทั้งหมดคอมไพล์และรันได้', r.mcuErr.length === 0, r.mcuErr.join(' | ')]);
  checks.push(['ardsense: อ่าน DHT22 / LDR / อัลตราโซนิก', r.senseLine === 'T=25C H=60% แสง=936 ระยะ=100cm PIR=0', r.senseLine]);
  checks.push(['ardsense: วัตถุใกล้ → บัซเซอร์ดัง, PIR ตรวจพบ', r.senseBz && r.sensePir, r.senseBz + ' ' + r.sensePir]);
  checks.push(['espgarden: ดินแห้ง → เซอร์โว 90°, ดินชื้น → 0°', Math.abs(r.servoDry - 90) < 1 && Math.abs(r.servoWet) < 1, r.servoDry + ' → ' + r.servoWet]);
  near('plcsense: ทรานสมิตเตอร์ 40% → AI0 ≈ 40', r.ai0, 40, 0.5);
  checks.push(['plcsense: พร็อกซิมิตี้ → Q0, ลิมิตสวิตช์ตัด, AI0 > 75 → Q2', r.q0off === 0 && r.q0on === 1 && r.q0lim === 0 && r.q2 === 1, [r.q0off, r.q0on, r.q0lim, r.q2].join(',')]);
  near('semi: 7805 จ่าย 5.00 V', r.reg, 5, 0.01);
  near('semi: ซีเนอร์คุม ≈ 5.11 V', r.vz, 5.11, 0.02);
  checks.push(['semi: S1 เปิด → NPN อิ่มตัว, LED ≈ 8.5 mA; S1 ปิด → LED ดับ', r.ledOff < 1e-6 && Math.abs(r.ledOn - 0.00846) < 0.0002 && r.qState === 'sat', r.ledOff + ' / ' + r.ledOn + ' / ' + r.qState]);
  checks.push(['timer555: สลับสถานะ ≈ 1 Hz (8 ครั้งใน 4 s)', r.t555 >= 7 && r.t555 <= 9, r.t555]);
  checks.push(['counter: ผ่านไป 1.5 s แสดงเลข 1 (ส่วน b, c)', r.seg === 'bc', r.seg]);
  checks.push(['motor: กดปุ่ม → MOSFET นำ, กระแสสตาร์ทสูงแล้วลดลงเมื่อหมุน (แรงเคลื่อนย้อนกลับ)', r.motorOff < 1e-6 && r.motorOn > 2*r.motorRun && r.motorRun < 0.15, r.motorOff + ' → ' + r.motorOn.toFixed(3) + ' → ' + r.motorRun.toFixed(3)]);
  near('stardelta: กระแสสตาร์ทแบบสตาร์ ≈ 1/3 ของ DOL (≈ 34 A)', r.sdInrush, 34.4, 1);
  checks.push(['stardelta: ช่วงแรกต่อสตาร์ (K2) กระแส ≈ 4.8 A', r.sdStar[0] === 'Y' && r.sdStar[1] && Math.abs(r.sdStar[2] - 4.81) < 0.1, JSON.stringify(r.sdStar)]);
  checks.push(['stardelta: ครบ 5 s เปลี่ยนเป็นเดลต้า (K3) กระแส ≈ In 14.3 A', r.sdDelta[0] === 'Δ' && r.sdDelta[1] && !r.sdDelta[2] && Math.abs(r.sdDelta[3] - 14.3) < 0.2, JSON.stringify(r.sdDelta)]);
  checks.push(['stardelta: เฟสขาด → คราง แล้วอุปกรณ์ป้องกันตัด', r.sdHum && r.sdProt, r.sdHum + ' ' + r.sdProt]);
  checks.push(['stardelta: กด E-Stop → K1 หลุด', r.estop === false, r.estop]);
  checks.push(['rcdtest: คนแตะสายไฟ → RCD ตัด (ไฟรั่ว) กระแสผ่านตัว ≈ 0', r.rcd0 && r.rcd1[0] === false && r.rcd1[1] === 'rcd' && r.rcd1[2] < 1e-3, JSON.stringify(r.rcd1)]);
  checks.push(['pfc: ต่อคาปาซิเตอร์ PF 0.65 → > 0.95 กระแสลดลง', Math.abs(r.pf0[0] - 0.65) < 0.01 && r.pf1[0] > 0.95 && r.pf1[1] < r.pf0[1], r.pf0.map(x => x.toFixed(3)) + ' → ' + r.pf1.map(x => x.toFixed(3))]);
  checks.push(['stair: สลับสวิตช์ตัวใดก็ได้ → ไฟสลับติด/ดับ', JSON.stringify(r.stair) === '[true,false,true,false]', JSON.stringify(r.stair)]);
  checks.push(['factory: ก่อนกด START สายพานหยุด, กดแล้ววิ่ง, กด STOP แล้วหยุด', r.facIdle === 0 && r.facConv === 1 && r.facStop < 0.05, [r.facIdle, r.facConv, r.facStop].join(' → ')]);
  checks.push(['factory: PLC คัดกล่องโลหะด้วยกระบอกลมครบ ไม่มีคัดผิด/หลุด (60 s)', r.facCnt.metal >= 5 && r.facCnt.other >= 5 && r.facCnt.miss === 0 && r.facCnt.wrong === 0, JSON.stringify(r.facCnt)]);
  checks.push(['seqconv: สายพานปลายทางเริ่มก่อน ต้นทางตามหลัง 3 s', JSON.stringify([r.seq1, r.seq2]) === '[[true,false],[true,true]]', JSON.stringify([r.seq1, r.seq2])]);
  checks.push(['seqconv: กด STOP ต้นทางหยุดทันที ปลายทางหยุดหลัง 4 s', JSON.stringify([r.seq3, r.seq4]) === '[[true,false],[false,false]]', JSON.stringify([r.seq3, r.seq4])]);
  checks.push(['seqconv: กล่องข้ามสายพานลงถังครบ ไม่ตกพื้น', r.seqCnt.metal + r.seqCnt.other >= 8 && r.seqCnt.floor === 0, JSON.stringify(r.seqCnt)]);
  checks.push(['gate: กด OPEN → เปิดสุด ลิมิต SQ1 ตัด K1', r.gate0[0] === 0 && r.gate0[1] === true && r.gate1[0] >= 0.995 && !r.gate1[1] && r.gate1[2] === true, JSON.stringify(r.gate1)]);
  checks.push(['gate: กด STOP กลางทาง → ประตูหยุดนิ่ง', r.gate2[0] > 0.1 && r.gate2[0] < 0.9 && Math.abs(r.gate2[0] - r.gate2[1]) < 0.01 && !r.gate2[2], JSON.stringify(r.gate2)]);
  checks.push(['gate: กด CLOSE → ปิดสนิท ลิมิต SQ2 ตัด K2', r.gate3[0] <= 0.005 && !r.gate3[1] && r.gate3[2] === true, JSON.stringify(r.gate3)]);
  checks.push(['plcpump: มีฉากสถานีสูบน้ำ 3D', r.tankScene === 'tank,pump,cab,station', r.tankScene]);
  checks.push(['จัดวางฉากเอง (สายพาน + ตัวปล่อย + ถัง) ทำงานกับมอเตอร์บนแผง', r.custom.other >= 8 && r.custom.floor === 0, JSON.stringify(r.custom)]);
  checks.push(['pickplace: แขนหยิบวางย้ายกล่องลงถังครบ ไม่ตกพื้น (60 s)', r.pick.metal + r.pick.other >= 10 && r.pick.floor === 0, JSON.stringify(r.pick)]);
  checks.push(['ตัวกั้นชิ้นงาน: ไม่มีไฟ → กล่องต่อคิวรอ, มีไฟ → กล่องไหลลงถัง', r.stopHeld[0] === 0 && r.stopHeld[1] >= 4 && r.stopOpen >= 5, JSON.stringify([r.stopHeld, r.stopOpen])]);
  checks.push(['dol: ฉากพัดลมหมุนตามมอเตอร์บนแผง', r.dolScene === 'fan,cab,station,beacon' && r.fanTurns, r.dolScene]);
  checks.push(['pico: ไฟจราจร 3D ตาม LED บนแผง (แดง → เขียว)', JSON.stringify([r.traffic, r.traffic2]) === '[[true,false],[false,true]]', JSON.stringify([r.traffic, r.traffic2])]);
  checks.push(['lift: เริ่มที่ชั้นล่าง (SQ1) แล้วยกกล่องขึ้นถึงชั้นบน 2 m', r.liftSq[0] === true && r.liftSq[1] === false && r.liftTop > 50 && Math.abs(r.liftMaxY - 2.15) < 0.02, [r.liftTop, r.liftMaxY].join(' / ')]);
  checks.push(['lift: กล่องผ่านลิฟต์ → สายพานชั้นบน → ทางลาด → ถัง ครบ ไม่ตกพื้น (120 s)', r.lift.metal + r.lift.other >= 6 && r.lift.floor === 0, JSON.stringify(r.lift)]);
  checks.push(['หลายระดับ: กล่องตกจากสายพานสูงลงสายพานลาดเอียงด้านล่างแล้วลงถัง', r.cascade.other >= 10 && r.cascade.floor === 0, JSON.stringify(r.cascade)]);
  checks.push(['osc: CH1 ไซน์ 12 Vrms (Vpp ≈ 33.8 V) 50 Hz ทริกได้', Math.abs(r.osc[0] - 33.8) < 0.3 && Math.abs(r.osc[1] - 11.97) < 0.1 && r.osc[2] === 50 && r.osc[7], r.osc.slice(0, 3).map(x => +x.toFixed(2)).join(' / ')]);
  checks.push(['osc: CH2 พัลส์ NE555 0–8.85 V ≈ 687 Hz ดิวตี้ ≈ 52%', Math.abs(r.osc[3] - 8.85) < 0.05 && Math.abs(r.osc[4]) < 0.01 && Math.abs(r.osc[5] - 687) < 1 && Math.abs(r.osc[6] - 0.524) < 0.005, r.osc.slice(3, 7).map(x => +x.toFixed(3)).join(' / ')]);
  checks.push(['osc: AC coupling ตัด DC ออก (ค่าเฉลี่ย ≈ 0)', r.oscAC < 0.05, r.oscAC]);
  checks.push(['osc: Auto Set เลือก 10 V/div, 5 V/div, 5 ms/div ทริก CH1', JSON.stringify(r.oscAuto) === '[10,5,0.005,"1"]', JSON.stringify(r.oscAuto)]);
  checks.push(['osc: โหมดเลื่อน (roll) วัดพัลส์ช้า ≈ 0.69 Hz และแถบไซน์ 33.8 Vpp', r.oscRoll[0] && Math.abs(r.oscRoll[1] - 0.69) < 0.03 && Math.abs(r.oscRoll[2] - 33.8) < 0.3, JSON.stringify(r.oscRoll)]);
  checks.push(['osc: ตรวจพบ PWM ของ Arduino 490 Hz', r.pwmSw.length === 1 && r.pwmSw[0][0] === 490, JSON.stringify(r.pwmSw)]);
  checks.push(['FFT: ไซน์ 50 Hz → ยอดเดียว 50 Hz ≈ 11.97 Vrms, THD ≈ 0', Math.abs(r.fft1[0] - 50) < 0.2 && Math.abs(r.fft1[1] - 11.97) < 0.1 && r.fft1[2] === 1 && r.fft1[3] < 0.01, JSON.stringify(r.fft1)]);
  // คลื่นสี่เหลี่ยม 0–8.85 V ดิวตี้ 0.524: Vn(rms) = 2A/(nπ)·|sin(nπd)|/√2 → H1 3.97, H3 1.29, H5 0.74; DC = A·d = 4.64
  checks.push(['FFT: พัลส์ NE555 → หลัก 687 Hz 3.97 V, H3 1.29 V, H5 0.74 V, DC 4.64 V', Math.abs(r.fft2[0] - 687) < 1 && Math.abs(r.fft2[1] - 3.97) < 0.04 && Math.abs(r.fft2[2] - 1.29) < 0.03 && Math.abs(r.fft2[3] - 0.74) < 0.03 && Math.abs(r.fft2[4] - 4.64) < 0.05 && r.fft2[5] === 10000, JSON.stringify(r.fft2.map(x => +x.toFixed(3)))]);
  checks.push(['XY: วงจร RC ผลต่างเฟส ≈ −46°', Math.abs(r.xy[0] + 46.0) < 0.3 && r.xy[1] > 1000, JSON.stringify(r.xy)]);
  checks.push(['Math CH1−CH2: แรงดันคร่อม R Vpp ≈ 24.4 V, 8.64 Vrms 50 Hz (FFT และโหมดเลื่อนตรงกัน)', Math.abs(r.math[0] - 24.42) < 0.2 && Math.abs(r.math[1] - 8.63) < 0.08 && r.math[2] === 50 && Math.abs(r.math[3] - 50) < 0.2 && Math.abs(r.math[4] - 8.63) < 0.08 && Math.abs(r.math[5] - 24.42) < 0.2, JSON.stringify(r.math.map(x => +x.toFixed(3)))]);
  checks.push(['เคอร์เซอร์: Δt = 20 ms (1/Δt = 50 Hz), แรงดัน A 25 V B 5 V ΔV −20 V', Math.abs(r.cur[0] - 0.02) < 1e-9 && Math.abs(r.cur[1] - 50) < 1e-6 && r.cur[2] === 25 && r.cur[3] === 5 && r.cur[4] === -20, JSON.stringify(r.cur)]);
  checks.push(['โพรบ: ×1 อ่าน 3.33 V (โหลด 1 MΩ), ×10 อ่าน 4.76 V; Single รอทริกแล้วจับขั้นบันได + STOP', r.probe[0] === true && r.probe[1] === true && r.probe[2] && r.probe[3] === false && Math.abs(r.probe[4] - 3.33) < 0.02 && Math.abs(r.probe[5]) < 0.05 && Math.abs(r.probe[6] - 4.75) < 0.03, JSON.stringify(r.probe)]);
  checks.push(['ทริก Normal (โหมดเลื่อน): ค้างพัลส์ 0.5 s ที่ 1 ช่องจากซ้าย', r.norm[0] && r.norm[1] < 0.05 && Math.abs(r.norm[2] - 4.75) < 0.03 && r.norm[3] < 0.05, JSON.stringify(r.norm)]);
  checks.push(['โพรบ: วัด 322 Vpk ด้วย ×1 เตือนเกินพิกัด, ×10 ไม่เตือน', r.prwarn[0] && !r.prwarn[1], JSON.stringify(r.prwarn)]);
  // ลาก/หมุนอุปกรณ์ด้วยเมาส์จริง: สายไฟตามไป วงจรยังต่ออยู่ · Alt+ลาก = ถอดสาย · ขั้วชนกันตรง ๆ ได้สายเชื่อมอัตโนมัติ
  await page.setViewportSize({width:1400, height:900});
  await page.evaluate(() => window.__sim.load('series')); await page.waitForTimeout(200);
  const g2c = (gx, gy) => page.evaluate(([gx, gy]) => { const cv = document.querySelector('canvas'), q = cv.getBoundingClientRect();
    const a = s2g({clientX:q.left, clientY:q.top}), b = s2g({clientX:q.left + 100, clientY:q.top + 100});
    return [q.left + (gx - a[0])*100/(b[0] - a[0]), q.top + (gy - a[1])*100/(b[1] - a[1])]; }, [gx, gy]);
  const IA = () => page.evaluate(() => { window.__sim.solveNow(); return window.__sim.RES.comp[window.__sim.find('A1').id].Ir; });
  const dragTo = async (a, b, alt) => { const [x, y] = await g2c(...a), [x2, y2] = await g2c(...b); if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x2, y2, {steps:5}); await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); };
  const mv = [];
  await dragTo([5, 2], [5, 4]); mv.push(await IA());
  { const [x, y] = await g2c(9, 2); await page.mouse.click(x, y); await page.keyboard.press('r'); } mv.push(await IA());
  await dragTo([9, 2], [9, 8], true); mv.push(await IA());
  await page.keyboard.press('Control+z'); mv.push(await IA());
  mv.push(await page.evaluate(() => { const s = window.__sim;
    s.load({comps:[{id:1, t:'bat', x:2, y:3, r:1, V:10, n:'B1'}, {id:2, t:'res', x:3, y:2, R:10, n:'R1'}, {id:3, t:'res', x:3, y:4, R:10, n:'R2'}], wires:[{x1:4, y1:2, x2:4, y2:4}], nid:4});
    const c = s.find('R1'), F = followInit(c); c.x = 5; c.y = 0; followApply(c, F); s.solveNow(); return s.RES.comp[2].Ir; }));
  mv.push(await page.evaluate(() => { view.z = 0.4; setPinTol({pointerType:'mouse'}); const h = hitPin(2.35, 2); view.z = 1; return !!h && h.x === 2; }));
  checks.push(['ย้าย/หมุนอุปกรณ์ สายไฟตามไป (0.25 A คงเดิม), Alt+ลาก ถอดสาย, ย้อนกลับได้, ขั้วชนกันได้สายเชื่อม, ซูมออกยังจับขั้วได้',
    Math.abs(mv[0] - 0.25) < 0.002 && Math.abs(mv[1] - 0.25) < 0.002 && mv[2] < 1e-3 && Math.abs(mv[3] - 0.25) < 0.002 && Math.abs(mv[4] - 0.5) < 0.002 && mv[5] === true, JSON.stringify(mv.map(v => typeof v === 'number' ? +v.toFixed(4) : v))]);
  // ลากสายผ่านมุม/จุดต่อของสายอื่นกลางเส้น → ไม่ต่อกัน; ปลายสายตกกลางสายอื่น → ต่อ (T)
  // วงจร: B1 10 V → R1 100 Ω ปิดวงจรเอง และสายแนวตั้งของ B2 มีจุดหักที่ y = 6 — สายใหม่แนวนอน y = 6 ผ่านทั้งสองจุดหัก
  await page.evaluate(() => { window.__sim.load({comps:[{id:1, t:'bat', x:4, y:3, r:1, V:10, n:'B1'}, {id:2, t:'res', x:4, y:9, r:1, R:100, n:'R1'}, {id:3, t:'bat', x:8, y:3, r:1, V:5, n:'B2'}, {id:4, t:'res', x:8, y:9, r:1, R:100, n:'R2'}],
    wires:[{x1:4, y1:4, x2:4, y2:6}, {x1:4, y1:6, x2:4, y2:8}, {x1:8, y1:4, x2:8, y2:6}, {x1:8, y1:6, x2:8, y2:8}, {x1:4, y1:10, x2:4, y2:12}, {x1:4, y1:12, x2:3, y2:12}, {x1:3, y1:12, x2:3, y2:2}, {x1:3, y1:2, x2:4, y2:2},
      {x1:8, y1:10, x2:8, y2:12}, {x1:8, y1:12, x2:9, y2:12}, {x1:9, y1:12, x2:9, y2:2}, {x1:9, y1:2, x2:8, y2:2}], nid:5}); });
  await page.waitForTimeout(100);
  const IR = () => page.evaluate(() => { window.__sim.solveNow(); const R = window.__sim.RES.comp; return [R[2].Ir, R[4].Ir]; });
  const cr = [await IR()];
  await page.keyboard.press('w'); await dragTo([2, 6], [10, 6]); cr.push(await IR());
  cr.push(await page.evaluate(() => window.__sim.S.wires.filter(w => w.y1 === 6 && w.y2 === 6).length));
  await dragTo([6, 1], [6, 6]); cr.push(await page.evaluate(() => window.__sim.S.wires.filter(w => w.y1 === 6 && w.y2 === 6).length));
  await page.keyboard.press('Escape');
  checks.push(['ลากสายผ่านจุดหักของสายอื่นไม่ต่อกัน (กระแส R1/R2 เท่าเดิม), ปลายสายตกกลางสาย → แยกเป็นจุดต่อ T',
    Math.abs(cr[0][0] - 0.1) < 0.002 && Math.abs(cr[0][1] - 0.05) < 0.002 && Math.abs(cr[1][0] - 0.1) < 0.002 && Math.abs(cr[1][1] - 0.05) < 0.002 && cr[2] === 1 && cr[3] === 2, JSON.stringify(cr)]);
  for (const md of ['lad', 'txt']){ const e = r['elev_' + md];
    checks.push([`ลิฟต์ 3 ชั้น (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): ขึ้นไปชั้น 3 แวะชั้น 2 ที่เรียกระหว่างทาง (ประตูเปิด) แล้วลงชั้น 1`,
      e[0] && Math.abs(e[1] - 1.5) < 0.07 && e[2] && e[3] && e[4] && Math.abs(e[5] - 3) < 0.07 && e[6] && Math.abs(e[7]) < 0.07 && e[8] && e[9], JSON.stringify(e.map(v => typeof v === 'number' ? +v.toFixed(2) : v))]); }
  for (const md of ['lad', 'txt']) checks.push([`เซนเซอร์อุตสาหกรรม (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): โฟลว์/ความดัน (ดิฟเฟอเรนเชียล)/ม่านแสง/แก๊ส/อัลตราโซนิก/เทอร์โมสตัท/คาปาซิทีฟ`,
    JSON.stringify(r['ind_' + md]) === JSON.stringify(['1011','1011','1111','0011','0011','1011','0100','0101','1010','1001','1000']), JSON.stringify(r['ind_' + md])]);
  checks.push(['RS-485 (MAX485): มาสเตอร์ส่ง P=60 → สเลฟรับ, หมุน pot 20% → LED หรี่ลง, บอดไม่ตรง → อ่านไม่ออก',
    r.c485[0] === null && r.c485[1] && r.c485[3] && r.c485[4] < r.c485[2] && !r.c485[5], JSON.stringify(r.c485)]);
  checks.push(['LoRa (E32): 1.5 km รับได้ (RSSI ≈ −110 dBm), 9 km ที่ SF9 ขาด, เปลี่ยนเป็น SF12 → รับได้อีกครั้ง',
    JSON.stringify(r.clora) === JSON.stringify([true, true, -110, true, false, true, true]), JSON.stringify(r.clora)]);
  checks.push(['RS-232 (MAX3232): บอร์ดทักทายเทอร์มินัล, สั่ง ON/OFF ได้, บอดเทอร์มินัลไม่ตรง → คำสั่งไม่ผ่าน',
    JSON.stringify(r.c232) === JSON.stringify([true, 1, true, 0, 0]), JSON.stringify(r.c232)]);
  for (const md of ['lad', 'txt']){ const e = r['mb_' + md];
    checks.push([`Modbus RTU (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): PLC อ่าน pot 75% → D0 = 767, H1 + coil 0 ติด, D8 → PWM; pot 30% → D0 = 307 ดับ + LED หรี่; ปุ่ม → coil 1; บอดสเลฟไม่ตรง → CRC ผิด/timeout`,
      e[0] === 767 && e[1] === 767 && e[2] && e[3] && e[5] === 307 && e[6] && e[7] && e[8] && e[9] && e[10] && e[11] && e[12], JSON.stringify(e)]); }
  checks.push(['PLC: D3 := (AI0 + 10)*2 − D1/4 = 60, Q0 := D3 >= 60 · CRC Modbus ของ 01 03 00 00 00 01 = 84 0A',
    JSON.stringify(r.mbexpr) === '[0,60,1]' && r.crc === '01 03 00 00 00 01 84 0A', JSON.stringify([r.mbexpr, r.crc])]);
  for (const md of ['lad', 'txt']) checks.push([`HMI ↔ PLC Modbus RTU (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): อ่านไฟ/ค่า D5 = 1234, START → M2 = 1, STOP → M2 = 0, ID ผิด → timeout + เตือน`,
    JSON.stringify(r['hmb_' + md]) === JSON.stringify([true, 1, 1234, 1, 1, 0, 0, true, true]), JSON.stringify(r['hmb_' + md])]);
  checks.push(['PLC สเลฟ: อ่านคอยล์ 40 → ข้อยกเว้น 02 (0x81), เขียน holding 3 = 500 → D3', JSON.stringify(r.mbex) === '[2,129,0,500]', JSON.stringify(r.mbex)]);
  for (const md of ['lad', 'txt']) checks.push([`PLC 2 พอร์ต (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): #1 มาสเตอร์อ่าน Arduino + #2 สเลฟให้ HMI พร้อมกัน, ปุ่ม HMI → LED Arduino, บอดพอร์ต #2 ผิด → HMI timeout แต่ #1 ยังปกติ`,
    JSON.stringify(r['p2_' + md]) === JSON.stringify([767, true, true, 767, 1, 1, true, true, 307, 0, true, true]), JSON.stringify(r['p2_' + md])]);
  for (const md of ['lad', 'txt']) checks.push([`Modbus TCP (${md === 'lad' ? 'แลดเดอร์' : 'ข้อความ'}): S1 ที่ PLC2 → H1 ที่ PLC1, ตัวนับ D0 ถึง HMI, ปุ่ม HMI → PLC1 → PLC2 ไฟ H2, ซับเน็ตผิด/IP ซ้ำ/ไม่มีลิงก์ แจ้งเตือน`,
    JSON.stringify(r['tcp_' + md]) === JSON.stringify([0, true, true, 1, 1, 1, 1, 0, true, true, true]), JSON.stringify(r['tcp_' + md])]);
  checks.push(['Modbus TCP: MBAP ของ TID 7 อ่าน holding 0–3 = 00 07 00 00 00 06 01 03 00 00 00 04', r.mbap === '00 07 00 00 00 06 01 03 00 00 00 04', r.mbap]);
  checks.push(['บัส RS-485 วัดแรงดันได้: ว่าง A−B ≈ 0.21 V (ไบแอส 680 Ω), A−GND ≈ 2.6 V; ขณะส่ง A−B ≈ 2.8 V',
    r.busV[0] && r.busV[1] && Math.abs(r.busV[0][0] - 0.21) < 0.05 && Math.abs(r.busV[0][1] - 2.6) < 0.2 && r.busV[1][0] > 2, JSON.stringify(r.busV)]);
  checks.push(['ESP32 Wi-Fi + Modbus TCP: ได้ IP/RSSI −55, pot 30% → D10 ≈ 1228, 90% → H1 + LED บอร์ด, ปุ่ม → M5, ไกล 500 m → หลุด, กลับ 15 m → ต่อใหม่, รหัสผิด → WL_CONNECT_FAILED',
    JSON.stringify(r.wifi_txt) === JSON.stringify([null, true, true, 0, true, 1, 1, 1, 1, 0, 6, true, 3, true, 4, 'รหัสผ่าน Wi-Fi ไม่ถูกต้อง']), JSON.stringify(r.wifi_txt)]);
  checks.push(['ESP32 Wi-Fi + Modbus TCP (PLC แบบแลดเดอร์): ผลเหมือนกัน', JSON.stringify(r.wifi_lad) === JSON.stringify(r.wifi_txt.slice(0, 14)), JSON.stringify(r.wifi_lad)]);
  checks.push(['สโคปจับเฟรม UART บนบัส RS-485: ถอดรหัส "P=60⏎" (50 3D 36 30 0A), บิต 104 µs, A/B สลับกัน, Auto Set → 1 ms/div',
    JSON.stringify(r.sbus) === JSON.stringify(['P=60⏎', '50 3D 36 30 0A', 104, true, true, true, 0.001]), JSON.stringify(r.sbus)]);
  checks.push(['ไม่มี error ในหน้าเว็บ', errors.length === 0, errors.join(' | ')]);

  let fail = 0;
  for (const [name, ok, v] of checks){ if (!ok) fail++; console.log((ok ? 'ผ่าน  ' : 'ไม่ผ่าน ') + name + '  → ' + (typeof v === 'number' ? +v.toFixed(5) : v)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
