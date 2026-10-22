import { describe, expect, it } from "vitest";
import { GestureHold, LookTracker, OneEuro, buildCalibration, classifyWithHysteresis, dPrime, fitGazeMap, gazeStats, type HV } from "./filters";

let seed = 7;
const gauss = () => {
  // Box–Muller on a deterministic LCG
  const u = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
};
const cluster = (h: number, v: number, sd: number, n = 40): HV[] => Array.from({ length: n }, () => ({ h: h + gauss() * sd, v: v + gauss() * sd }));

describe("calibration statistics", () => {
  it("mean and 2D spread of a lens sample, robust to a glance away", () => {
    const s = [...cluster(3, -2, 1, 30), { h: 30, v: 20 }, { h: -25, v: 10 }];
    const st = gazeStats(s)!;
    expect(st.n).toBeGreaterThanOrEqual(29);
    expect(st.n).toBeLessThanOrEqual(30);
    expect(Math.abs(st.h - 3)).toBeLessThan(0.6);
    expect(Math.abs(st.v + 2)).toBeLessThan(0.6);
    expect(st.sd).toBeGreaterThan(1.0); // 2D RMS of SD-1 per axis ≈ 1.41
    expect(st.sd).toBeLessThan(1.9);
  });

  it("d′ of well separated clusters is large, of overlapping ones small", () => {
    const cam = gazeStats(cluster(0, 0, 1))!;
    expect(dPrime(cam, gazeStats(cluster(0, 12, 1))!)).toBeGreaterThan(8);
    expect(dPrime(cam, gazeStats(cluster(1, 1, 2))!)).toBeLessThan(2);
  });

  it("builds the Calibration record", () => {
    const cam = gazeStats(cluster(2, -1, 1))!;
    const only = buildCalibration(cam, null, 5);
    expect(only).toMatchObject({ screen: null, radius: 8, separation: null, at: 5 });
    expect(Math.abs(only.cam.h - 2)).toBeLessThan(0.6);

    const near = buildCalibration(cam, gazeStats(cluster(2, 9, 1))!, 5); // screen 10° below the lens
    expect(near.screen).not.toBeNull();
    expect(Math.abs(near.screen!.v - 10)).toBeLessThan(0.8);
    expect(Math.abs(near.radius! - 5)).toBeLessThan(0.5); // half the lens–screen distance
    expect(near.separation!).toBeGreaterThan(2);

    const far = buildCalibration(cam, gazeStats(cluster(2, 29, 1))!, 5);
    expect(far.radius).toBe(8);

    const bad = buildCalibration(cam, gazeStats(cluster(3, 0, 2))!, 5);
    expect(bad.screen).toBeNull();
    expect(bad.separation!).toBeLessThan(2);
    expect(bad.radius).toBe(8);
  });
});

describe("gaze map", () => {
  // a person whose model output is compressed (0.6×) and offset: true screen geometry 40 px/deg, lens 4° above the top
  const raw = (x: number, y: number) => ({ h: 2 + 0.6 * ((720 - x) / 40), v: -3 + 0.6 * ((y - 160) / 40) });
  const dots = [[720, 450], [720, 90], [115, 400], [1325, 400], [720, 810]].map(([x, y]) => ({ ...raw(x, y), x, y }));
  const lensRaw = raw(720, -160);
  const lens = gazeStats(cluster(lensRaw.h, lensRaw.v, 0.4))!;

  it("recovers the screen geometry from five dots and puts the lens above the screen", () => {
    const m = fitGazeMap(dots, lens, 1440, 900)!;
    expect(m).not.toBeNull();
    expect(Math.abs(m.lens.x - 720)).toBeLessThan(25);
    expect(Math.abs(m.lens.y + 160)).toBeLessThan(25);
    expect(m.rms).toBeLessThan(1);
    expect(m.r).toBeGreaterThan(150); // ≈ 0.35 × lens–centre distance (610 px)
    expect(m.r).toBeLessThan(260);
  });
  it("rejects dots that don't describe a screen", () => {
    expect(fitGazeMap(dots.slice(0, 3), lens, 1440, 900)).toBeNull();
    const centre = gazeStats(cluster(raw(720, 450).h, raw(720, 450).v, 0.4))!;
    expect(fitGazeMap(dots, centre, 1440, 900)).toBeNull(); // "lens" sample in the middle of the screen
  });
  it("live tracker uses the map: the monitor above is away, the lens is camera", () => {
    const m = fitGazeMap(dots, lens, 1440, 900)!;
    const calib = { cam: { h: lens.h, v: lens.v }, screen: null, spread: 0.4, at: 0, map: m };
    const lt = new LookTracker();
    const at = (x: number, y: number, t: number) => { const g = raw(x, y); return lt.update({ face: true, rel: { dH: g.h - lens.h, dV: g.v - lens.v }, headYaw: 0, calib }, t); };
    at(720, -160, 0);
    expect(at(720, -160, 300)).toBe("camera");
    at(720, -700, 400);
    expect(at(720, -700, 700)).toBe("away");
    at(500, 500, 800);
    expect(at(500, 500, 1100)).toBe("screen");
  });
});

describe("live look", () => {
  it("hysteresis: 8° radius is entered at 6° and left at 10°", () => {
    expect(classifyWithHysteresis({ dH: 7, dV: 0 }, null, 8, "away")).toBe("away");
    expect(classifyWithHysteresis({ dH: 5.9, dV: 0 }, null, 8, "away")).toBe("camera");
    expect(classifyWithHysteresis({ dH: 9.5, dV: 0 }, null, 8, "camera")).toBe("camera");
    expect(classifyWithHysteresis({ dH: 10.5, dV: 0 }, null, 8, "camera")).toBe("away");
    expect(classifyWithHysteresis({ dH: 0, dV: 20 }, null, 8, "camera")).toBe("down");
    expect(classifyWithHysteresis({ dH: 0, dV: 12 }, { h: 0, v: 12 }, 6, "camera")).toBe("screen");
  });

  it("needs 200 ms dwell and ignores a jittering border", () => {
    const lt = new LookTracker();
    const at = (dH: number, t: number) => lt.update({ face: true, rel: { dH, dV: 0 }, headYaw: 0, calib: null }, t);
    expect(at(0, 0)).toBe("none");
    expect(at(0, 250)).toBe("camera");
    // jitter around 9° (the uncalibrated radius): stays camera
    let t = 300;
    for (let i = 0; i < 20; i++, t += 33) expect(at(i % 2 ? 9.8 : 8.2, t)).toBe("camera");
    // a 100 ms glance away does not switch
    expect(at(25, t)).toBe("camera");
    expect(at(25, t + 100)).toBe("camera");
    expect(at(0, t + 133)).toBe("camera");
    // a held look away does
    expect(at(25, t + 200)).toBe("camera");
    expect(at(25, t + 420)).toBe("away");
  });

  it("head turned > 40° is away from head pose alone; blink keeps the class", () => {
    const lt = new LookTracker();
    lt.update({ face: true, rel: { dH: 0, dV: 0 }, headYaw: 0, calib: null }, 0);
    lt.update({ face: true, rel: { dH: 0, dV: 0 }, headYaw: 0, calib: null }, 300);
    expect(lt.update({ face: true, rel: null, headYaw: 0, calib: null }, 900)).toBe("camera");
    lt.update({ face: true, rel: null, headYaw: 50, calib: null }, 1000);
    expect(lt.update({ face: true, rel: null, headYaw: 50, calib: null }, 1300)).toBe("away");
    lt.update({ face: false, rel: null, headYaw: 0, calib: null }, 1400);
    expect(lt.update({ face: false, rel: null, headYaw: 0, calib: null }, 1700)).toBe("none");
  });
});

describe("one-euro", () => {
  it("settles on a step with τ ≈ 200 ms at rest", () => {
    const f = new OneEuro(0.8, 0);
    f.filter(0, 0);
    let y = 0;
    for (let t = 100; t <= 200; t += 100) y = f.filter(10, t);
    expect(y).toBeGreaterThan(4); // ~1 − e^(−1) after 200 ms
    expect(y).toBeLessThan(8);
    for (let t = 300; t <= 2000; t += 100) y = f.filter(10, t);
    expect(Math.abs(y - 10)).toBeLessThan(0.05);
  });
});

describe("gesture hold", () => {
  it("fires after holdMs, once, and again only after a release", () => {
    const g = new GestureHold<"Thumb_Up" | "Victory">(800, 0.6, 250);
    const fires: string[] = [];
    const run = (name: "Thumb_Up" | "Victory" | null, score: number, t: number) => {
      const r = g.update(name ? { name, score } : null, t);
      if (r.fire) fires.push(r.fire);
      return r.state;
    };
    expect(run("Thumb_Up", 0.9, 0)?.progress).toBe(0);
    expect(run("Thumb_Up", 0.9, 400)?.progress).toBeCloseTo(0.5);
    expect(run(null, 0, 466)?.progress).toBeCloseTo(0.5); // one missed detection: ring holds
    expect(run("Thumb_Up", 0.9, 533)?.progress).toBeCloseTo(533 / 800);
    run("Thumb_Up", 0.9, 800);
    run("Thumb_Up", 0.9, 1500);
    expect(fires).toEqual(["Thumb_Up"]);
    expect(run("Thumb_Up", 0.5, 1566)).not.toBeNull(); // low score within grace
    expect(run(null, 0, 1800)).toBeNull(); // released
    run("Thumb_Up", 0.9, 1900);
    run("Thumb_Up", 0.9, 2750);
    expect(fires).toEqual(["Thumb_Up", "Thumb_Up"]);
    run("Victory", 0.7, 2800);
    expect(run("Victory", 0.7, 3700)?.name).toBe("Victory");
    expect(fires).toEqual(["Thumb_Up", "Thumb_Up", "Victory"]);
    expect(run("Thumb_Up", 0.55, 3766)?.name).toBe("Victory"); // below minScore counts as not seen
  });
});
