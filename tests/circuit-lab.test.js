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

    o.mcuErr = ['arduino','esp32','pico','ardsense','espgarden'].map(k => (s.load(k), s.run(0.3), s.find('U1')._vm.err)).filter(Boolean);
    return o;
  });

  const checks = [];
  const near = (name, v, want, tol) => checks.push([name, Math.abs(v - want) <= tol, v]);
  near('series 0.25 A', r.series, 0.25, 0.002);
  near('parallel 1.5 A', r.parallel, 1.5, 0.01);
  near('mixed 54.5 mA', r.mixed, 0.0545, 0.0005);
  near('led 21 mA', r.led, 0.021, 0.0005);
  checks.push(['dol: K1 ดูด', r.dolCoil === true, r.dolCoil]);
  for (let k = 0; k < 3; k++) near('dol: กระแสเฟส ' + (k + 1) + ' 2.55 A', r.dolI[k], 2.55, 0.01);
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
  checks.push(['ไม่มี error ในหน้าเว็บ', errors.length === 0, errors.join(' | ')]);

  let fail = 0;
  for (const [name, ok, v] of checks){ if (!ok) fail++; console.log((ok ? 'ผ่าน  ' : 'ไม่ผ่าน ') + name + '  → ' + (typeof v === 'number' ? +v.toFixed(5) : v)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
