// Minimal test harness for computeGroupSlots logic (copied/adapted from renderer.js)
// Run: node scripts/test-group-slots.js

const lsaMode = false;
const attendanceMode = false;

function widthAwareCircleAngles(rx, ry, count, startAngle, cardW, cardH, spanAngle = 2 * Math.PI) {
  const N = Math.max(count * 120, 1080);
  const dTheta = spanAngle / N;
  const cumWeighted = [0];

  for (let i = 0; i < N; i++) {
    const a = startAngle - (i + 0.5) * dTheta;
    const tanX = rx * Math.abs(Math.sin(a));
    const tanY = ry * Math.abs(Math.cos(a));
    const T2 = tanX * tanX + tanY * tanY;
    const footprintScale = cardW * tanX + cardH * tanY;
    const nsGap = cardH * (tanY / Math.max(Math.sqrt(T2), 0.001));
    const w = T2 / Math.max(footprintScale + 8 * Math.sqrt(T2) + 10 * nsGap, 0.001);
    cumWeighted.push(cumWeighted[i] + w * dTheta);
  }

  const total = cumWeighted[N];
  const interval = count > 1 ? total / (count - 1) : 0;
  const result = [];
  let si = 0;
  for (let k = 0; k < count; k++) {
    const target = k * interval;
    while (si < N - 1 && cumWeighted[si + 1] < target) si++;
    const frac =
      cumWeighted[si + 1] > cumWeighted[si]
        ? (target - cumWeighted[si]) / (cumWeighted[si + 1] - cumWeighted[si])
        : 0;
    result.push(startAngle - (si + frac) * dTheta);
  }
  return result;
}

function computeGroupSlots(studentList, canvasW, canvasH, options = {}) {
  const type = options.type || 'squads';
  const countMode = options.countMode || 'count';
  const countValue = Number(options.countValue) || 3;
  const total = studentList.length || 0;

  const BASE_W = 148;
  const cardW = BASE_W;
  const cardH = lsaMode ? 118 : 96;
  const colGapX = 16;
  const rowGapY = lsaMode ? 18 : 14;
  const margin = 8;

  let groupCount;
  if (countMode === 'size') {
    groupCount = Math.max(1, Math.ceil(total / Math.max(1, Math.floor(countValue))));
  } else {
    groupCount = Math.max(1, Math.floor(countValue) || 1);
  }
  groupCount = Math.min(groupCount, Math.max(1, total));

  const slots = [];
  if (total === 0) return slots;

  if (type === 'selfspace') {
    // SELF-SPACE: choose a tight grid using effective sizes that account for
    // Attendance/LSA expanded card heights. Aim for an edge gap of ~4-5px.
    const BASE_W2 = 148;
    const rawW2 = BASE_W2;
    const regularMinH2 = Math.round(Math.max(46, rawW2 * 0.56));
    const spacingCardH2 = lsaMode ? 72 : attendanceMode ? 82 : regularMinH2;

    const effW = cardW;
    const effH = Math.max(cardH, spacingCardH2);

    const availW = Math.max(100, canvasW - margin * 2);
    const availH = Math.max(100, canvasH - margin * 2 - (lsaMode ? 180 : 0));

    let best = { cols: 1, scale: 0 };
    const MIN_EDGE_GAP = 2; // target inter-card gap in px (prefer tighter grids)
    const maxColsSearch = Math.min(total, 120);
    for (let colsCandidate = 1; colsCandidate <= maxColsSearch; colsCandidate++) {
      const rowsCandidate = Math.ceil(total / colsCandidate);
      const reqW = colsCandidate * effW + (colsCandidate - 1) * MIN_EDGE_GAP;
      const reqH = rowsCandidate * effH + (rowsCandidate - 1) * MIN_EDGE_GAP;
      const scaleW = availW / Math.max(1, reqW);
      const scaleH = availH / Math.max(1, reqH);
      const scaleCandidate = Math.min(1, scaleW, scaleH);
      // Prefer larger scale; on ties prefer the wider grid (more columns)
      if (
        scaleCandidate > best.scale ||
        (Math.abs(scaleCandidate - best.scale) < 1e-6 && colsCandidate > best.cols)
      ) {
        best = { cols: colsCandidate, rows: rowsCandidate, scale: scaleCandidate };
      }
    }

    const scale = Math.max(0.25, best.scale);
    const cols = Math.max(1, Math.min(total, best.cols));
    const rows = Math.ceil(total / cols);
    const cellW = Math.max(32, Math.round(effW * scale));
    const cellH = Math.max(28, Math.round(effH * scale));
    const gapX = Math.max(2, Math.round(MIN_EDGE_GAP * scale));
    const gapY = Math.max(2, Math.round(MIN_EDGE_GAP * scale));

    const gridW = cols * cellW + Math.max(0, cols - 1) * gapX;
    const gridH = rows * cellH + Math.max(0, rows - 1) * gapY;
    const startX = Math.max(margin, Math.round((canvasW - gridW) / 2));
    const lsaTopReserve = lsaMode ? 180 : 0;
    const topOfGrid =
      lsaTopReserve + Math.max(0, Math.round((canvasH - lsaTopReserve - gridH) / 2));

    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({
        x: startX + col * (cellW + gapX),
        y: topOfGrid + row * (cellH + gapY),
        w: cellW,
        h: cellH,
      });
    }

    return slots;
  }

  // For squads and stations we need to partition into groups
  const base = Math.floor(total / groupCount);
  let rem = total % groupCount;
  const groupSizes = new Array(groupCount).fill(0).map(() => (rem > 0 ? (rem--, base + 1) : base));
  // Trim trailing zero-size groups
  while (groupSizes.length > 0 && groupSizes[groupSizes.length - 1] === 0) groupSizes.pop();

  if (type === 'squads') {
    // Compute adaptive widths
    let w = cardW;
    let gapX = colGapX;
    let totalW = groupSizes.length * w + Math.max(0, groupSizes.length - 1) * gapX;
    if (totalW + margin * 2 > canvasW) {
      const scale = Math.max(0.6, (canvasW - margin * 2) / Math.max(1, totalW));
      w = Math.max(68, Math.round(w * scale));
      gapX = Math.max(6, Math.round(gapX * scale));
      totalW = groupSizes.length * w + Math.max(0, groupSizes.length - 1) * gapX;
    }

    const startX = Math.max(margin, Math.round((canvasW - totalW) / 2));
    const lsaTopReserve = lsaMode ? 180 : 0;

    const tallestColH = Math.max(
      ...groupSizes.map((s) => s * cardH + Math.max(0, s - 1) * rowGapY)
    );
    const bottomY =
      lsaTopReserve +
      Math.max(0, Math.round((canvasH - lsaTopReserve - tallestColH) / 2)) +
      tallestColH;

    for (let gi = 0, index = 0; gi < groupSizes.length; gi++) {
      const size = groupSizes[gi];
      const colX = startX + gi * (w + gapX);
      const colH = size * cardH + Math.max(0, size - 1) * rowGapY;
      const topOfColumn = bottomY - colH;
      for (let k = 0; k < size; k++, index++) {
        slots.push({ x: colX, y: topOfColumn + (size - 1 - k) * (cardH + rowGapY), w, h: cardH });
      }
    }

    return slots;
  }

  // Stations: compact 2-D clusters arranged on an oval; grid-of-clusters fallback
  if (type === 'stations') {
    const intraGapX = 2;
    const intraGapY = 2;
    const interClusterGap = 24;
    const clusterPad = 10;

    const groups = [];
    let gOffset = 0;
    for (let gi = 0; gi < groupSizes.length; gi++) {
      groups.push(studentList.slice(gOffset, gOffset + groupSizes[gi]));
      gOffset += groupSizes[gi];
    }

    function buildCluster(n) {
      const cellW = cardW + intraGapX;
      const cellH = cardH + intraGapY;
      const positions = [];

      const baseCols = Math.ceil(Math.sqrt(n > 1 && n % 2 === 1 ? n - 1 : n));
      const useTopCard = n > 1 && n % 2 === 1 && (n - 1) % baseCols === 0;

      if (useTopCard) {
        const baseRows = (n - 1) / baseCols;
        const totalRows = baseRows + 1;
        positions.push({ x: 0, y: -((totalRows - 1) / 2) * cellH });
        for (let i = 0; i < n - 1; i++) {
          const c = i % baseCols;
          const r = Math.floor(i / baseCols);
          positions.push({
            x: (c - (baseCols - 1) / 2) * cellW,
            y: (r + 1 - (totalRows - 1) / 2) * cellH,
          });
        }
      } else {
        const cols = n === 2 ? 1 : Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        for (let i = 0; i < n; i++) {
          const c = i % cols;
          const r = Math.floor(i / cols);
          positions.push({
            x: (c - (cols - 1) / 2) * cellW,
            y: (r - (rows - 1) / 2) * cellH,
          });
        }
      }

      const minX = Math.min(...positions.map((p) => p.x)) - cardW / 2;
      const maxX = Math.max(...positions.map((p) => p.x)) + cardW / 2;
      const minY = Math.min(...positions.map((p) => p.y)) - cardH / 2;
      const maxY = Math.max(...positions.map((p) => p.y)) + cardH / 2;
      return { positions, footprintW: maxX - minX, footprintH: maxY - minY };
    }

    const clusterDefs = groups.map((g) => buildCluster(g.length));
    const maxClusterW = Math.max(...clusterDefs.map((c) => c.footprintW));
    const maxClusterH = Math.max(...clusterDefs.map((c) => c.footprintH));

    function emitStationSlots(centers) {
      for (let gi = 0; gi < groups.length; gi++) {
        const { positions } = clusterDefs[gi];
        const { cx, cy } = centers[gi];
        for (const p of positions) {
          slots.push({
            x: Math.round(cx + p.x - cardW / 2),
            y: Math.round(cy + p.y - cardH / 2),
            w: cardW,
            h: cardH,
          });
        }
      }
    }

    if (groups.length >= 2) {
      const ovalRx = Math.min(canvasW * 0.42, (canvasW - maxClusterW) / 2 - 16);
      const ovalRy = Math.min(canvasH * 0.42, (canvasH - maxClusterH) / 2 - 16);
      if (ovalRx > 0 && ovalRy > 0) {
        const stationsSpan = (2 * Math.PI * (groups.length - 1)) / groups.length;
        const angles = widthAwareCircleAngles(
          ovalRx,
          ovalRy,
          groups.length,
          (270 * Math.PI) / 180 - 0.05,
          maxClusterW + clusterPad * 2,
          maxClusterH + clusterPad * 2,
          stationsSpan
        );
        const centers = angles.map((a) => ({
          cx: canvasW / 2 + ovalRx * Math.cos(a),
          cy: canvasH / 2 - ovalRy * Math.sin(a),
        }));
        let anyOverlap = false;
        for (let i = 0; i < centers.length && !anyOverlap; i++) {
          const ai = {
            x: centers[i].cx - clusterDefs[i].footprintW / 2 - clusterPad,
            y: centers[i].cy - clusterDefs[i].footprintH / 2 - clusterPad,
            w: clusterDefs[i].footprintW + clusterPad * 2,
            h: clusterDefs[i].footprintH + clusterPad * 2,
          };
          for (let j = i + 1; j < centers.length; j++) {
            const bj = {
              x: centers[j].cx - clusterDefs[j].footprintW / 2 - clusterPad,
              y: centers[j].cy - clusterDefs[j].footprintH / 2 - clusterPad,
              w: clusterDefs[j].footprintW + clusterPad * 2,
              h: clusterDefs[j].footprintH + clusterPad * 2,
            };
            if (
              ai.x < bj.x + bj.w &&
              ai.x + ai.w > bj.x &&
              ai.y < bj.y + bj.h &&
              ai.y + ai.h > bj.y
            ) {
              anyOverlap = true;
              break;
            }
          }
        }
        if (!anyOverlap) {
          emitStationSlots(centers);
          return slots;
        }
      }
    }

    // Attempt 2: rectangle perimeter arrangement
    if (groups.length >= 2) {
      const rectRx = Math.min(canvasW * 0.42, (canvasW - maxClusterW) / 2 - 16);
      const rectRy = Math.min(canvasH * 0.42, (canvasH - maxClusterH) / 2 - 16);
      if (rectRx > 0 && rectRy > 0) {
        const perimeter = 4 * (rectRx + rectRy);
        const spacing = perimeter / groups.length;
        const startOffset = rectRx;
        const cx0 = canvasW / 2;
        const cy0 = canvasH / 2;
        function rectPerimPoint(d) {
          d = ((d % perimeter) + perimeter) % perimeter;
          const sTop = 2 * rectRx;
          const sRight = 2 * rectRy;
          const sBottom = 2 * rectRx;
          if (d < sTop) {
            return { rx: -rectRx + d, ry: -rectRy };
          } else if (d < sTop + sRight) {
            return { rx: rectRx, ry: -rectRy + (d - sTop) };
          } else if (d < sTop + sRight + sBottom) {
            return { rx: rectRx - (d - sTop - sRight), ry: rectRy };
          } else {
            return { rx: -rectRx, ry: rectRy - (d - sTop - sRight - sBottom) };
          }
        }
        const rectCenters = groups.map((_, gi) => {
          const d = (startOffset + gi * spacing) % perimeter;
          const { rx, ry } = rectPerimPoint(d);
          return { cx: cx0 + rx, cy: cy0 + ry };
        });
        let anyOverlap = false;
        for (let i = 0; i < rectCenters.length && !anyOverlap; i++) {
          const ai = {
            x: rectCenters[i].cx - clusterDefs[i].footprintW / 2 - clusterPad,
            y: rectCenters[i].cy - clusterDefs[i].footprintH / 2 - clusterPad,
            w: clusterDefs[i].footprintW + clusterPad * 2,
            h: clusterDefs[i].footprintH + clusterPad * 2,
          };
          for (let j = i + 1; j < rectCenters.length; j++) {
            const bj = {
              x: rectCenters[j].cx - clusterDefs[j].footprintW / 2 - clusterPad,
              y: rectCenters[j].cy - clusterDefs[j].footprintH / 2 - clusterPad,
              w: clusterDefs[j].footprintW + clusterPad * 2,
              h: clusterDefs[j].footprintH + clusterPad * 2,
            };
            if (
              ai.x < bj.x + bj.w &&
              ai.x + ai.w > bj.x &&
              ai.y < bj.y + bj.h &&
              ai.y + ai.h > bj.y
            ) {
              anyOverlap = true;
              break;
            }
          }
        }
        if (!anyOverlap) {
          emitStationSlots(rectCenters);
          return slots;
        }
      }
    }

    // Fallback: grid-of-cluster-blocks (visually distinct from squads columns)
    const nClusters = groups.length;
    const lsaTopReserve = lsaMode ? 180 : 0;
    let bestCols = 1;
    let bestScore = -1;
    for (let c = 1; c <= nClusters; c++) {
      const r = Math.ceil(nClusters / c);
      const totalW = c * maxClusterW + (c - 1) * interClusterGap;
      const totalH = r * maxClusterH + (r - 1) * interClusterGap;
      if (totalW + margin * 2 <= canvasW && totalH + lsaTopReserve + margin * 2 <= canvasH) {
        const fillRatio =
          (totalW / (canvasW - margin * 2)) * (totalH / (canvasH - lsaTopReserve - margin * 2));
        if (fillRatio > bestScore) {
          bestScore = fillRatio;
          bestCols = c;
        }
      }
    }
    if (bestScore < 0)
      bestCols = Math.min(
        nClusters,
        Math.max(1, Math.floor((canvasW - margin * 2) / (maxClusterW + interClusterGap)))
      );

    const bestRows = Math.ceil(nClusters / bestCols);
    const gridTotalW = bestCols * maxClusterW + (bestCols - 1) * interClusterGap;
    const gridTotalH = bestRows * maxClusterH + (bestRows - 1) * interClusterGap;
    const gridStartX = Math.max(margin, Math.round((canvasW - gridTotalW) / 2));
    const gridStartY =
      lsaTopReserve + Math.max(margin, Math.round((canvasH - lsaTopReserve - gridTotalH) / 2));

    const fallbackCenters = groups.map((_, gi) => {
      const col = gi % bestCols;
      const row = Math.floor(gi / bestCols);
      return {
        cx: gridStartX + col * (maxClusterW + interClusterGap) + maxClusterW / 2,
        cy: gridStartY + row * (maxClusterH + interClusterGap) + maxClusterH / 2,
      };
    });
    emitStationSlots(fallbackCenters);
    return slots;
  }

  return slots;
}

function makeStudents(n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ id: i, first_name: 'S', last_name: String(i) });
  return arr;
}

function detectOverlaps(slots, cardW = 148, cardH = 96) {
  let overlaps = 0;
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const wA = slots[i].w || cardW;
      const hA = slots[i].h || cardH;
      const wB = slots[j].w || cardW;
      const hB = slots[j].h || cardH;
      const dx = Math.abs(slots[i].x - slots[j].x);
      const dy = Math.abs(slots[i].y - slots[j].y);
      if (dx < Math.max(wA, wB) && dy < Math.max(hA, hB)) overlaps++;
    }
  }
  return overlaps;
}

const canvasW = 1100;
const canvasH = 720;

const cases = [
  // squads
  { n: 20, type: 'squads', mode: 'count', val: 4 },
  { n: 7, type: 'squads', mode: 'count', val: 3 },
  { n: 28, type: 'squads', mode: 'count', val: 6 },
  // stations – small groups (oval should succeed)
  { n: 16, type: 'stations', mode: 'count', val: 4 },
  { n: 20, type: 'stations', mode: 'size', val: 4 },
  // stations – small class with many groups (was falling back due to span bug)
  { n: 9, type: 'stations', mode: 'count', val: 7 },
  // stations – typical class sizes
  { n: 24, type: 'stations', mode: 'count', val: 3 },
  { n: 24, type: 'stations', mode: 'count', val: 4 },
  { n: 24, type: 'stations', mode: 'count', val: 6 },
  { n: 30, type: 'stations', mode: 'size', val: 5 },
  { n: 25, type: 'stations', mode: 'count', val: 5 },
  // stations – large clusters that may stress oval → rectangle path
  { n: 20, type: 'stations', mode: 'count', val: 2 }, // 2 groups of 10 — clusters are large
  { n: 18, type: 'stations', mode: 'count', val: 3 }, // 3 groups of 6
  // selfspace
  { n: 20, type: 'selfspace', mode: 'size', val: 4 },
  { n: 100, type: 'selfspace', mode: 'count', val: 0 },
];

let allPassed = true;
for (const c of cases) {
  const students = makeStudents(c.n);
  const slots = computeGroupSlots(students, canvasW, canvasH, {
    type: c.type,
    countMode: c.mode,
    countValue: c.val,
  });
  const ov = detectOverlaps(slots);
  const pass = slots.length === c.n && ov === 0;
  if (!pass) allPassed = false;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} n=${c.n}, type=${c.type}, mode=${c.mode}, val=${c.val}, slots=${slots.length}, overlaps=${ov}`
  );
}

console.log(allPassed ? '\nAll cases passed.' : '\nSome cases FAILED.');
