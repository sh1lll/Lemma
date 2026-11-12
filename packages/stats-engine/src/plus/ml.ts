// Data-science / ML math: classification and regression metrics, ROC-AUC, log loss, cross-entropy, activations,
// decision-tree split gain. Models (gradient descent, backprop, naive Bayes, kNN, PCA, k-means, factor analysis,
// regularisation, model size) live in ml-models.ts.
import { bracketGroups, g, label, listAfter, ln, matrixAfter, num, runValues, sigmoid } from './ml-common';
import { MODEL_HANDLERS } from './ml-models';
import { answer, bad, matrixOf, needErr, param, ranks, type Line, type PCtx, type PHandler } from './util';

// ---------- binary classification metrics ----------

interface Counts {
  tp: number | null;
  fp: number | null;
  fn: number | null;
  tn: number | null;
}

type Need = keyof Counts;
interface Metric {
  key: string;
  re: RegExp;
  label: string;
  needs: Need[];
  fn: (c: { tp: number; fp: number; fn: number; tn: number }, beta: number) => number;
}

const div = (a: number, b: number) => (b === 0 ? NaN : a / b);
const kappaOf = (k: { tp: number; fp: number; fn: number; tn: number }) => {
  const n = k.tp + k.fp + k.fn + k.tn;
  const po = (k.tp + k.tn) / n;
  const pe = ((k.tp + k.fp) * (k.tp + k.fn) + (k.fn + k.tn) * (k.fp + k.tn)) / (n * n);
  return div(po - pe, 1 - pe);
};

const METRICS: Metric[] = [
  { key: 'mcc', re: /\bmcc\b|\bmatthews\b/, label: 'MCC', needs: ['tp', 'fp', 'fn', 'tn'], fn: (k) => div(k.tp * k.tn - k.fp * k.fn, Math.sqrt((k.tp + k.fp) * (k.tp + k.fn) * (k.tn + k.fp) * (k.tn + k.fn))) },
  { key: 'balanced', re: /\bbalanced accuracy\b/, label: 'Balanced accuracy', needs: ['tp', 'fp', 'fn', 'tn'], fn: (k) => (div(k.tp, k.tp + k.fn) + div(k.tn, k.tn + k.fp)) / 2 },
  {
    key: 'fbeta', re: /\bf[- ]?beta\b|\bf2\b|\bf0\.5\b|\bf-2\b/, label: 'F-beta', needs: ['tp', 'fp', 'fn'],
    fn: (k, b) => div((1 + b * b) * k.tp, (1 + b * b) * k.tp + b * b * k.fn + k.fp),
  },
  { key: 'f1', re: /\bf1\b|\bf-?score\b|\bf-?measure\b/, label: 'F1 score', needs: ['tp', 'fp', 'fn'], fn: (k) => div(2 * k.tp, 2 * k.tp + k.fp + k.fn) },
  { key: 'npv', re: /\bnpv\b|\bnegative predictive\b/, label: 'NPV', needs: ['tn', 'fn'], fn: (k) => div(k.tn, k.tn + k.fn) },
  { key: 'fpr', re: /\bfalse positive rate\b|\bfpr\b|\bfall-?out\b/, label: 'False positive rate', needs: ['fp', 'tn'], fn: (k) => div(k.fp, k.fp + k.tn) },
  { key: 'fnr', re: /\bfalse negative rate\b|\bfnr\b|\bmiss rate\b/, label: 'False negative rate', needs: ['fn', 'tp'], fn: (k) => div(k.fn, k.fn + k.tp) },
  { key: 'spec', re: /\bspecificity\b|\btrue negative rate\b|\btnr\b|\bselectivity\b/, label: 'Specificity', needs: ['tn', 'fp'], fn: (k) => div(k.tn, k.tn + k.fp) },
  { key: 'recall', re: /\brecall\b|\bsensitivity\b|\btrue positive rate\b|\btpr\b|\bhit rate\b/, label: 'Recall (sensitivity)', needs: ['tp', 'fn'], fn: (k) => div(k.tp, k.tp + k.fn) },
  { key: 'precision', re: /\bprecision\b|\bppv\b|\bpositive predictive\b/, label: 'Precision', needs: ['tp', 'fp'], fn: (k) => div(k.tp, k.tp + k.fp) },
  { key: 'kappa', re: /\bkappa\b/, label: "Cohen's kappa", needs: ['tp', 'fp', 'fn', 'tn'], fn: kappaOf },
  { key: 'prevalence', re: /\bprevalence\b/, label: 'Prevalence', needs: ['tp', 'fp', 'fn', 'tn'], fn: (k) => div(k.tp + k.fn, k.tp + k.fp + k.fn + k.tn) },
  { key: 'accuracy', re: /\baccuracy\b/, label: 'Accuracy', needs: ['tp', 'fp', 'fn', 'tn'], fn: (k) => div(k.tp + k.tn, k.tp + k.fp + k.fn + k.tn) },
];
const SHOWN = ['accuracy', 'precision', 'recall', 'spec', 'f1', 'npv', 'fpr', 'fnr', 'balanced', 'mcc', 'kappa', 'prevalence'];
const NEED_NAME: Record<Need, string> = { tp: 'true positives (tp)', fp: 'false positives (fp)', fn: 'false negatives (fn)', tn: 'true negatives (tn)' };

function betaOf(s: string): number {
  if (/\bf2\b|\bf-2\b/.test(s)) return 2;
  if (/\bf0\.5\b/.test(s)) return 0.5;
  return num(s, 'beta|β') ?? 1;
}

const show = (x: number) => (Number.isNaN(x) ? 'undefined (0/0)' : g(x));

function binaryReport(c: PCtx, k: { tp: number; fp: number; fn: number; tn: number }, asked: Metric | undefined, source: string, extraNotes: string[] = []) {
  const beta = betaOf(c.s);
  const metric = asked ?? METRICS.find((m) => m.key === 'accuracy')!;
  const lines: Line[] = [];
  for (const key of SHOWN) {
    const m = METRICS.find((x) => x.key === key)!;
    lines.push({ label: m.label, display: show(m.fn(k, beta)) });
  }
  if (metric.key === 'fbeta') lines.push({ label: `F${label(beta)} score`, display: show(metric.fn(k, beta)) });
  const v = metric.fn(k, beta);
  const notes = [
    `${source}: TP ${k.tp}, FP ${k.fp}, FN ${k.fn}, TN ${k.tn}`,
    'Precision = TP/(TP+FP), recall = TP/(TP+FN), specificity = TN/(TN+FP), F1 = 2TP/(2TP+FP+FN)',
    ...extraNotes,
  ];
  if (metric.key === 'mcc') notes.push('MCC = (TP·TN − FP·FN)/√((TP+FP)(TP+FN)(TN+FP)(TN+FN))');
  if (metric.key === 'fbeta') notes.push(`F-beta = (1+β²)·TP/((1+β²)·TP + β²·FN + FP), β = ${label(beta)}`);
  if (Number.isNaN(v)) notes.push(`${metric.label} is undefined here (division by zero)`);
  return answer(c, {
    expression: `${metric.key === 'fbeta' ? `F${label(beta)} score` : metric.label} · binary classification`,
    value: Number.isNaN(v) ? undefined : v,
    display: Number.isNaN(v) ? 'undefined' : undefined,
    lines,
    notes,
    table: { columns: ['', 'Predicted positive', 'Predicted negative'], rows: [['Actual positive', String(k.tp), String(k.fn)], ['Actual negative', String(k.fp), String(k.tn)]] },
  });
}

const fromCounts: PHandler = (c) => {
  const s = c.s;
  const k: Counts = {
    tp: param(s, 'tp|true positives?'),
    fp: param(s, 'fp|false positives?'),
    fn: param(s, 'fn|false negatives?'),
    tn: param(s, 'tn|true negatives?'),
  };
  const given = (Object.keys(k) as Need[]).filter((x) => k[x] !== null);
  if (!given.length) return null;
  const asked = METRICS.find((m) => m.re.test(s));
  const confusion = /\bconfusion\b|\bclassification (?:report|metrics)\b/.test(s);
  if (!asked && !confusion) return null;
  // "sensitivity 90% specificity 95% prevalence 1%" is a Bayes question, not counts.
  if (given.length < 2 && !/\b(?:tp|fp|fn|tn)\b/.test(s)) return null;
  for (const x of given) if (!(k[x]! >= 0) || !Number.isInteger(k[x]!)) bad(`The ${NEED_NAME[x]} must be a whole-number count, not ${k[x]}`);
  const needs: Need[] = asked && !confusion ? asked.needs : ['tp', 'fp', 'fn', 'tn'];
  const missing = needs.filter((x) => k[x] === null);
  if (missing.length) return needErr(c, `${asked && !confusion ? asked.label : 'The confusion matrix'} also needs the ${missing.map((x) => NEED_NAME[x]).join(', ')}`);
  if (given.length < 4) {
    const v = asked!.fn({ tp: k.tp ?? 0, fp: k.fp ?? 0, fn: k.fn ?? 0, tn: k.tn ?? 0 }, betaOf(s));
    return answer(c, { expression: `${asked!.key === 'fbeta' ? `F${label(betaOf(s))} score` : asked!.label} · ${given.map((x) => `${x.toUpperCase()} ${k[x]}`).join(', ')}`, value: Number.isNaN(v) ? undefined : v, display: Number.isNaN(v) ? 'undefined' : undefined, notes: Number.isNaN(v) ? ['Undefined: division by zero'] : [] });
  }
  return binaryReport(c, k as { tp: number; fp: number; fn: number; tn: number }, confusion && !asked ? undefined : asked, 'Counts');
};

// ---------- multi-class ----------

interface ClassStats {
  labels: string[];
  C: number[][];
}

function multiReport(c: PCtx, m: ClassStats, source: string) {
  const { C, labels } = m;
  const k = C.length;
  const n = C.flat().reduce((a, b) => a + b, 0);
  if (!(n > 0)) bad('The confusion matrix is empty');
  const rowSum = C.map((r) => r.reduce((a, b) => a + b, 0));
  const colSum = C[0]!.map((_v, j) => C.reduce((a, r) => a + r[j]!, 0));
  const diag = C.map((r, i) => r[i]!);
  const acc = diag.reduce((a, b) => a + b, 0) / n;
  let zeroDiv = false;
  const z = (x: number) => (Number.isNaN(x) ? ((zeroDiv = true), 0) : x);
  const prec = diag.map((d, j) => z(div(d, colSum[j]!)));
  const rec = diag.map((d, i) => z(div(d, rowSum[i]!)));
  const f1 = prec.map((p, i) => z(div(2 * p * rec[i]!, p + rec[i]!)));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const wmean = (xs: number[]) => xs.reduce((a, x, i) => a + x * rowSum[i]!, 0) / n;
  const pe = rowSum.reduce((a, r, i) => a + r * colSum[i]!, 0) / (n * n);
  const kappa = div(acc - pe, 1 - pe);
  const vals: Record<string, number> = {
    accuracy: acc,
    'macro precision': mean(prec), 'macro recall': mean(rec), 'macro f1': mean(f1),
    'micro precision': acc, 'micro recall': acc, 'micro f1': acc,
    'weighted precision': wmean(prec), 'weighted recall': wmean(rec), 'weighted f1': wmean(f1),
    kappa,
  };
  const s = c.s;
  const avg = /\bmicro\b/.test(s) ? 'micro' : /\bweighted\b/.test(s) ? 'weighted' : 'macro';
  const metric = /\bkappa\b/.test(s) ? 'kappa' : /\bf1\b|\bf-?score\b/.test(s) ? 'f1' : /\bprecision\b/.test(s) ? 'precision' : /\brecall\b|\bsensitivity\b/.test(s) ? 'recall' : 'accuracy';
  const key = metric === 'accuracy' || metric === 'kappa' ? metric : `${avg} ${metric}`;
  const notes = [`${source}; rows are actual classes, columns predicted (scikit-learn layout)`];
  if (metric !== 'accuracy' && metric !== 'kappa' && !/\b(?:macro|micro|weighted)\b/.test(s)) notes.push('Macro average (say “micro” or “weighted” for the others)');
  if (zeroDiv) notes.push('Some per-class precision/recall are 0/0; counted as 0, as scikit-learn does');
  const cap = (x: string) => x[0]!.toUpperCase() + x.slice(1);
  const lines: Line[] = [
    { label: 'Accuracy', display: g(acc) },
    ...['macro', 'micro', 'weighted'].flatMap((a) => ['precision', 'recall', 'f1'].map((mm) => ({ label: `${cap(a)} ${mm === 'f1' ? 'F1' : mm}`, display: g(vals[`${a} ${mm}`]!) }))),
    { label: 'Observed agreement', display: g(acc) },
    { label: 'Expected agreement', display: g(pe) },
    { label: "Cohen's kappa", display: show(kappa) },
  ];
  const v = vals[key]!;
  return answer(c, {
    expression: `${key === 'kappa' ? "Cohen's kappa" : cap(key).replace(' f1', ' F1')} · ${k} classes, ${n} cases`,
    value: v,
    lines,
    notes,
    table: {
      columns: ['Class', 'Precision', 'Recall', 'F1', 'Support'],
      rows: labels.map((l, i) => [l, g(prec[i]!, 4), g(rec[i]!, 4), g(f1[i]!, 4), String(rowSum[i])]),
    },
  });
}

const fromMatrix: PHandler = (c) => {
  if (!/\bconfusion\b|\bkappa\b|\bclassification report\b|\baccuracy\b|\bprecision\b|\brecall\b|\bf1\b|\bmcc\b|\bspecificity\b/.test(c.s)) return null;
  const M = matrixAfter(c.s, null) ?? matrixOf(c);
  if (!M) return null;
  const k = M.length;
  if (M.some((r) => r.length !== k)) bad(`A confusion matrix must be square; this one is ${k}×${M[0]!.length}`);
  if (M.flat().some((x) => !(x >= 0) || !Number.isInteger(x))) bad('Confusion-matrix entries must be whole-number counts');
  const isKappa = /\bkappa\b/.test(c.s);
  if (k === 2 && !isKappa) {
    const first = /\bpositive (?:class )?first\b|\bpositives? first\b/.test(c.s);
    const counts = first
      ? { tp: M[0]![0]!, fn: M[0]![1]!, fp: M[1]![0]!, tn: M[1]![1]! }
      : { tn: M[0]![0]!, fp: M[0]![1]!, fn: M[1]![0]!, tp: M[1]![1]! };
    const asked = METRICS.find((m) => m.re.test(c.s));
    return binaryReport(c, counts, asked, 'Matrix', [
      first ? 'Read as [[TP, FN], [FP, TN]] (positive class first)' : 'Read in scikit-learn layout [[TN, FP], [FN, TP]]: rows actual, columns predicted, positive class second (say “positive class first” for [[TP, FN], [FP, TN]])',
    ]);
  }
  return multiReport(c, { C: M, labels: M.map((_r, i) => String(i + 1)) }, isKappa ? 'Agreement table (rater 1 rows, rater 2 columns)' : 'Matrix');
};

const ACTUAL = 'actual|y_true|y true|true labels|true values|truth|ground truth|observed|targets?';
const PREDICTED = 'predicted|predictions|pred|y_pred|y pred|yhat|y_hat|y hat';

const fromLabels: PHandler = (c) => {
  const s = c.s;
  if (!/\baccuracy\b|\bprecision\b|\brecall\b|\bf1\b|\bf-?score\b|\bclassification report\b|\bconfusion\b|\bkappa\b|\bmcc\b|\bspecificity\b|\bsensitivity\b|\bbalanced accuracy\b/.test(s)) return null;
  const a = listAfter(s, ACTUAL);
  const p = listAfter(s, PREDICTED);
  if (!a || !p) return null;
  if (a.length !== p.length) bad(`There are ${a.length} actual labels but ${p.length} predicted ones`);
  const labs = [...new Set([...a, ...p])].sort((x, y) => x - y);
  const binary = labs.every((x) => x === 0 || x === 1) && !/\b(?:macro|micro|weighted|classification report)\b/.test(s);
  if (binary) {
    const k = { tp: 0, fp: 0, fn: 0, tn: 0 };
    a.forEach((y, i) => {
      const q = p[i]!;
      if (y === 1 && q === 1) k.tp++;
      else if (y === 0 && q === 1) k.fp++;
      else if (y === 1) k.fn++;
      else k.tn++;
    });
    return binaryReport(c, k, METRICS.find((m) => m.re.test(s)), `${a.length} labelled cases (positive class 1)`);
  }
  const C = labs.map((li) => labs.map((lj) => a.reduce((n, y, i) => n + (y === li && p[i] === lj ? 1 : 0), 0)));
  return multiReport(c, { C, labels: labs.map(label) }, `${a.length} labelled cases, classes ${labs.map(label).join(', ')}`);
};

// ---------- ROC-AUC ----------

const LABELS = 'labels|y_true|y true|y|actual|classes|truth|targets?';
const SCORES = 'scores|y_score|y scores|scores?|probabilities|probs|predicted probabilities|predictions|p';

const rocAuc: PHandler = (c) => {
  if (!/\broc\b|\bauc\b|\bauroc\b|\barea under the (?:roc )?curve\b/.test(c.s)) return null;
  const y = listAfter(c.s, LABELS);
  const sc = listAfter(c.s, SCORES);
  if (!y || !sc) return needErr(c, 'Give the true labels and the scores, e.g. "roc auc labels 0 0 1 1 scores 0.1 0.4 0.35 0.8"');
  if (y.length !== sc.length) bad(`The labels and scores must be the same number of values (${y.length} labels, ${sc.length} scores)`);
  if (y.some((v) => v !== 0 && v !== 1)) bad('ROC-AUC needs binary labels (0 or 1)');
  const nPos = y.filter((v) => v === 1).length;
  const nNeg = y.length - nPos;
  if (!nPos || !nNeg) return needErr(c, 'ROC-AUC needs both classes: at least one positive (1) and one negative (0) label');
  const r = ranks(sc);
  const rPos = r.reduce((s, v, i) => s + (y[i] === 1 ? v : 0), 0);
  const auc = (rPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
  const thr = [...new Set(sc)].sort((a, b) => b - a);
  const rows = [['∞', '0', '0'], ...thr.map((t) => {
    const tp = sc.filter((v, i) => v >= t && y[i] === 1).length;
    const fp = sc.filter((v, i) => v >= t && y[i] === 0).length;
    return [g(t, 6), g(fp / nNeg, 4), g(tp / nPos, 4)];
  })];
  return answer(c, {
    expression: `ROC-AUC · ${nPos} positives, ${nNeg} negatives`,
    value: auc,
    lines: [
      { label: 'AUC', display: g(auc) },
      { label: 'Gini (2·AUC − 1)', display: g(2 * auc - 1) },
    ],
    notes: ['AUC = probability a random positive scores above a random negative (Mann–Whitney U / (n₊·n₋)); ties count ½', 'Higher score = more likely positive'],
    table: { columns: ['Threshold (score ≥)', 'FPR', 'TPR'], rows },
  });
};

// ---------- log loss / cross-entropy ----------

const bitsOf = (s: string) => /\bbits?\b|\blog ?2\b|\bbase 2\b/.test(s);

const logLoss: PHandler = (c) => {
  const s = c.s;
  const named = /\blog ?loss\b|\blogloss\b|\bbinary cross[- ]?entropy\b|\bbce\b/.test(s);
  if (!named && !/\bcross[- ]?entropy\b/.test(s)) return null;
  const y = listAfter(s, 'labels|y_true|y true|y|actual|targets?|truth');
  const p = listAfter(s, 'probabilities|probs|p|y_pred|y pred|predicted|predictions|q');
  if (!y || !p) {
    if (!named) return null;
    return needErr(c, 'Give the labels and predicted probabilities, e.g. "log loss labels 1 0 0 1 probabilities 0.9 0.1 0.2 0.65"');
  }
  if (!named && y.length < 2) return null;
  if (y.length !== p.length) bad(`There are ${y.length} labels but ${p.length} probabilities`);
  if (p.some((v) => !(v >= 0 && v <= 1))) bad('Each probability must be between 0 and 1 (the predicted probability of class 1)');
  if (y.some((v) => v !== 0 && v !== 1)) bad('Log loss here needs binary labels (0 or 1)');
  const eps = 1e-15;
  const clipped = p.some((v) => v < eps || v > 1 - eps);
  const bits = bitsOf(s);
  const lg = (x: number) => (bits ? Math.log2(x) : ln(x));
  const per = y.map((v, i) => {
    const q = Math.min(1 - eps, Math.max(eps, p[i]!));
    return -(v * lg(q) + (1 - v) * lg(1 - q));
  });
  const L = per.reduce((a, b) => a + b, 0) / per.length;
  const notes = [`Log loss = −(1/n)·Σ[y·log p + (1 − y)·log(1 − p)], ${bits ? 'log base 2 (bits)' : 'natural log (nats)'}`, 'Each probability is the predicted probability of class 1'];
  if (clipped) notes.push('Probabilities of exactly 0 or 1 were clipped to [1e-15, 1 − 1e-15] (as scikit-learn does)');
  return answer(c, {
    expression: `Log loss (binary cross-entropy) · ${y.length} predictions`,
    value: L,
    lines: [{ label: 'Log loss', display: g(L) }, { label: 'Perplexity-style exp(loss)', display: g(bits ? 2 ** L : Math.exp(L)) }],
    notes,
    table: { columns: ['#', 'y', 'p', 'Loss'], rows: per.slice(0, 50).map((l, i) => [String(i + 1), label(y[i]!), g(p[i]!, 6), g(l, 6)]) },
  });
};

const crossEntropy: PHandler = (c) => {
  const s = c.s;
  if (!/\bcross[- ]?entropy\b|\bcategorical cross\b/.test(s)) return null;
  const bits = bitsOf(s);
  const lg = (x: number) => (bits ? Math.log2(x) : ln(x));
  let t: number[] | null = null;
  let p: number[] | null = null;
  let how = '';
  const cls = num(s, 'true class|correct class|target class|class|label');
  const probs = listAfter(s, 'probabilities|probs|predicted|predictions|softmax output|p|q');
  if (cls !== null && probs) {
    if (!Number.isInteger(cls) || cls < 0 || cls > probs.length) bad(`Class ${cls} doesn't match ${probs.length} probabilities`);
    const idx = cls === 0 ? 0 : cls - 1;
    t = probs.map((_v, i) => (i === idx ? 1 : 0));
    p = probs;
    how = `Classes counted from 1 (class 1 = first probability)${cls === 0 ? '; class 0 read as the first' : ''}`;
  } else if (/\b(?:1|one)-?hot\b|\btarget\b|\btrue\b/.test(s)) {
    const br = bracketGroups(s);
    if (br.length >= 2) {
      t = br[0]!;
      p = br[1]!;
      how = 'Target distribution first, predicted probabilities second';
    }
  }
  if (!t || !p) return null;
  if (t.length !== p.length) bad(`The target has ${t.length} entries but the prediction has ${p.length}`);
  if (p.some((v) => !(v >= 0 && v <= 1))) bad('Each predicted probability must be between 0 and 1');
  const notes = [`H(t, p) = −Σ tᵢ·log pᵢ, ${bits ? 'log base 2 (bits)' : 'natural log (nats)'}`, how];
  const sp = p.reduce((a, b) => a + b, 0);
  if (Math.abs(sp - 1) > 1e-6) notes.push(`The predicted probabilities sum to ${g(sp)}, not 1; used as given`);
  let H = 0;
  t.forEach((ti, i) => {
    if (ti > 0) H -= ti * lg(Math.max(1e-15, p![i]!));
  });
  return answer(c, { expression: 'Categorical cross-entropy', value: H, lines: [{ label: 'Cross-entropy', display: g(H) }], notes });
};

// ---------- regression metrics ----------

const regressionMetrics: PHandler = (c) => {
  const s = c.s;
  if (!/\b(?:mse|mae|rmse|mape|r2 score|r² score|r-squared score|mean squared error|mean absolute error|root mean squared?(?: error)?|mean absolute percentage(?: error)?)\b/.test(s)) return null;
  const a = listAfter(s, 'actual|y_true|y true|true values|true|observed|y|targets?');
  const p = listAfter(s, 'predicted|predictions|pred|y_pred|y pred|yhat|y_hat|y hat|forecasts?|fitted');
  if (!a || !p) return needErr(c, 'Give the actual and predicted values, e.g. "mse actual 3 -0.5 2 7 predicted 2.5 0 2 8"');
  if (a.length !== p.length) bad(`There are ${a.length} actual values but ${p.length} predicted ones`);
  const n = a.length;
  const e = a.map((y, i) => y - p[i]!);
  const mse = e.reduce((s2, x) => s2 + x * x, 0) / n;
  const mae = e.reduce((s2, x) => s2 + Math.abs(x), 0) / n;
  const hasZero = a.some((y) => y === 0);
  const mape = hasZero ? NaN : (100 * e.reduce((s2, x, i) => s2 + Math.abs(x / a[i]!), 0)) / n;
  const ybar = a.reduce((s2, y) => s2 + y, 0) / n;
  const sst = a.reduce((s2, y) => s2 + (y - ybar) ** 2, 0);
  const r2 = sst === 0 ? NaN : 1 - (mse * n) / sst;
  const which = /\brmse\b|\broot mean/.test(s) ? 'RMSE' : /\bmape\b|\bpercentage\b/.test(s) ? 'MAPE' : /\bmae\b|\bmean absolute\b/.test(s) ? 'MAE' : /\bmse\b|\bmean squared\b/.test(s) ? 'MSE' : 'R²';
  const vals: Record<string, number> = { MSE: mse, RMSE: Math.sqrt(mse), MAE: mae, MAPE: mape, 'R²': r2 };
  const v = vals[which]!;
  const notes = ['Error = actual − predicted; MSE = mean(e²), RMSE = √MSE, MAE = mean|e|, MAPE = 100·mean|e/actual|, R² = 1 − SSres/SStot'];
  if (hasZero) notes.push('MAPE is undefined: an actual value is 0');
  return answer(c, {
    expression: `${which} · ${n} predictions`,
    value: Number.isNaN(v) ? undefined : v,
    display: Number.isNaN(v) ? 'undefined' : which === 'MAPE' ? `${g(v)}%` : undefined,
    lines: [
      { label: 'MSE', display: g(mse) },
      { label: 'RMSE', display: g(Math.sqrt(mse)) },
      { label: 'MAE', display: g(mae) },
      { label: 'MAPE', display: hasZero ? 'undefined' : `${g(mape)}%` },
      { label: 'R²', display: show(r2) },
    ],
    notes,
  });
};

// ---------- activations ----------

function afterKeyword(s: string, re: RegExp): string {
  const m = re.exec(s);
  return m ? s.slice(m.index + m[0].length) : s;
}

const softmax: PHandler = (c) => {
  if (!/\bsoftmax\b/.test(c.s) || /\bderivative\b|\bgraph\b|\bplot\b/.test(c.s)) return null;
  let text = afterKeyword(c.s, /\bsoftmax\b/);
  const T = num(text, 'temperature|temp|t');
  text = text.replace(/\b(?:temperature|temp|t)\s*(?:[:=]|of|is)?\s*-?[\d.]+/, ' ');
  const z = runValues(text.replace(/\b(?:of|logits?|scores?|values?)\b/g, ' '));
  if (z.length < 2) return needErr(c, 'Give at least two logits, e.g. "softmax of 1 2 3"');
  const temp = T ?? 1;
  if (!(temp > 0)) bad('The temperature must be positive');
  const m = Math.max(...z);
  const ex = z.map((x) => Math.exp((x - m) / temp));
  const S = ex.reduce((a, b) => a + b, 0);
  const p = ex.map((x) => x / S);
  return answer(c, {
    expression: `Softmax of ${z.map(label).join(', ')}${T !== null ? ` · temperature ${label(temp)}` : ''}`,
    display: p.map((x) => g(x, 6)).join(', '),
    lines: p.map((x, i) => ({ label: `p${i + 1}`, display: g(x) })),
    notes: [`softmax(z)ᵢ = e^(zᵢ/T) / Σ e^(zⱼ/T)${T === null ? ', T = 1' : ''}`, `Largest: p${p.indexOf(Math.max(...p)) + 1}`],
  });
};

const activations: PHandler = (c) => {
  const s = c.s;
  if (/\bderivative\b|\bintegra|\bgraph\b|\bplot\b|\binverse\b/.test(s)) return null;
  const kind = /\bsigmoid\b|\blogistic (?:function|sigmoid|activation)\b|\blogistic of\b/.test(s)
    ? 'sigmoid'
    : /\bleaky relu\b/.test(s)
      ? 'leaky'
      : /\brelu\b/.test(s)
        ? 'relu'
        : /\btanh\b/.test(s)
          ? 'tanh'
          : null;
  if (!kind) return null;
  const re = kind === 'sigmoid' ? /\bsigmoid\b|\blogistic (?:function|sigmoid|activation)?\b/ : kind === 'leaky' ? /\bleaky relu\b/ : kind === 'relu' ? /\brelu\b/ : /\btanh\b/;
  let text = afterKeyword(s, re);
  const slope = num(text, 'slope|alpha|a');
  text = text.replace(/\b(?:slope|alpha|a)\s*(?:[:=]|of|is)?\s*-?[\d.]+/, ' ');
  const xs = runValues(text.replace(/[()]/g, ' '));
  if (!xs.length) return null;
  if (kind === 'tanh' && xs.length < 2 && !/\bactivation\b/.test(s)) return null; // tanh(0.5) is the calculator's
  const name = kind === 'leaky' ? 'leaky relu' : kind === 'sigmoid' ? 'σ' : kind;
  const al = slope ?? 0.01;
  const fn = (x: number) => (kind === 'sigmoid' ? sigmoid(x) : kind === 'tanh' ? Math.tanh(x) : kind === 'relu' ? Math.max(0, x) : x > 0 ? x : al * x);
  const ys = xs.map(fn);
  const formula = kind === 'sigmoid' ? 'σ(x) = 1 / (1 + e^(−x))' : kind === 'tanh' ? 'tanh(x) = (eˣ − e^(−x)) / (eˣ + e^(−x))' : kind === 'relu' ? 'ReLU(x) = max(0, x)' : `Leaky ReLU(x) = x if x > 0, else ${label(al)}·x`;
  return answer(c, {
    expression: `${kind === 'sigmoid' ? 'Sigmoid' : kind === 'tanh' ? 'tanh' : kind === 'relu' ? 'ReLU' : 'Leaky ReLU'} of ${xs.map(label).join(', ')}`,
    value: xs.length === 1 ? ys[0] : undefined,
    display: xs.length === 1 ? undefined : ys.map((y) => g(y, 6)).join(', '),
    lines: xs.map((x, i) => ({ label: `${name}(${label(x)})`, display: g(ys[i]!) })),
    notes: [formula],
  });
};

// ---------- decision-tree split gain ----------

const H2 = (cs: number[]) => {
  const n = cs.reduce((a, b) => a + b, 0);
  return n ? -cs.reduce((h, x) => h + (x ? (x / n) * Math.log2(x / n) : 0), 0) : 0;
};
const Gini = (cs: number[]) => {
  const n = cs.reduce((a, b) => a + b, 0);
  return n ? 1 - cs.reduce((h, x) => h + (x / n) ** 2, 0) : 0;
};

const splitGain: PHandler = (c) => {
  const s = c.s;
  if (!/\binformation gain\b|\bsplit gain\b|\bgini (?:gain|impurity|index of (?:a )?node)\b|\bentropy (?:split|gain|impurity)\b|\bgain ratio\b|\bimpurity\b/.test(s)) return null;
  const pi = s.search(/\bparent\b/);
  const restAfter = pi >= 0 ? s.slice(pi + 6) : s;
  const ciRel = restAfter.search(/\b(?:split|splits|children|child|into|branches)\b/);
  const ci = ciRel >= 0 ? (pi >= 0 ? pi + 6 : 0) + ciRel : -1;
  const giniFirst = /\bgini\b/.test(s);
  let parent: number[] | null = null;
  let kids: number[][] = [];
  if (ci >= 0) {
    const childText = s.slice(ci).replace(/^\s*(?:split|splits|children|child|into|branches)\b/, ' ');
    kids = bracketGroups(childText);
    if (kids.length < 2) kids = childText.split(/[|;]|\band\b/).map((x) => runValues(x)).filter((x) => x.length);
    if (pi >= 0) {
      const pt = s.slice(pi + 6, ci);
      parent = bracketGroups(pt)[0] ?? runValues(pt);
    }
  } else if (pi < 0) {
    // A single node's impurity: "gini impurity of 9 5"
    const xs = runValues(afterKeyword(s, /\bimpurity\b|\bgini index\b/));
    if (xs.length < 2) return needErr(c, 'Give the class counts, e.g. "gini impurity of 9 5"');
    if (xs.some((x) => x < 0)) bad('Class counts cannot be negative');
    const gi = Gini(xs);
    const h = H2(xs);
    const useGini = giniFirst || !/\bentropy\b/.test(s);
    return answer(c, {
      expression: `${useGini ? 'Gini impurity' : 'Entropy'} of a node with class counts ${xs.map(label).join(', ')}`,
      value: useGini ? gi : h,
      lines: [{ label: 'Gini impurity', display: g(gi) }, { label: 'Entropy (bits)', display: g(h) }],
      notes: ['Gini = 1 − Σ pᵢ², entropy = −Σ pᵢ·log₂ pᵢ'],
    });
  }
  if (kids.length < 2) return needErr(c, 'Give the parent class counts and each child\'s counts, e.g. "information gain parent [9, 5] children [6, 2] [3, 3]"');
  const k = kids[0]!.length;
  if (kids.some((x) => x.length !== k)) bad('Every child needs a count for each class');
  const summed = Array.from({ length: k }, (_v, j) => kids.reduce((a, x) => a + x[j]!, 0));
  if (!parent || !parent.length) parent = summed;
  if (parent.length !== k) bad(`The parent has ${parent.length} classes but the children have ${k}`);
  if (parent.some((x, j) => Math.abs(x - summed[j]!) > 1e-9)) bad(`The children's counts per class (${summed.map(label).join(', ')}) must add up to the parent's (${parent.map(label).join(', ')})`);
  const N = parent.reduce((a, b) => a + b, 0);
  const w = kids.map((x) => x.reduce((a, b) => a + b, 0) / N);
  const hP = H2(parent);
  const hC = kids.reduce((a, x, i) => a + w[i]! * H2(x), 0);
  const gP = Gini(parent);
  const gC = kids.reduce((a, x, i) => a + w[i]! * Gini(x), 0);
  const splitInfo = -w.reduce((a, x) => a + (x ? x * Math.log2(x) : 0), 0);
  const ig = hP - hC;
  const gg = gP - gC;
  const ratio = /\bgain ratio\b/.test(s);
  const v = giniFirst ? gg : ratio ? ig / splitInfo : ig;
  return answer(c, {
    expression: `${giniFirst ? 'Gini gain' : ratio ? 'Gain ratio' : 'Information gain'} of a split into ${kids.length} children`,
    value: v,
    lines: [
      { label: 'Parent entropy', display: g(hP) },
      { label: 'Weighted child entropy', display: g(hC) },
      { label: 'Information gain', display: g(ig) },
      { label: 'Parent Gini', display: g(gP) },
      { label: 'Weighted child Gini', display: g(gC) },
      { label: 'Gini gain', display: g(gg) },
      { label: 'Split information', display: g(splitInfo) },
      { label: 'Gain ratio', display: show(ig / splitInfo) },
    ],
    notes: ['Entropy in bits (log₂); gain = parent impurity − weighted average of the children\'s'],
    table: { columns: ['Node', 'Counts', 'Weight', 'Entropy', 'Gini'], rows: [['Parent', parent.map(label).join(' / '), '1', g(hP, 4), g(gP, 4)], ...kids.map((x, i) => [`Child ${i + 1}`, x.map(label).join(' / '), g(w[i]!, 4), g(H2(x), 4), g(Gini(x), 4)])] },
  });
};

export const HANDLERS: PHandler[] = [
  ...MODEL_HANDLERS,
  splitGain,
  softmax,
  activations,
  rocAuc,
  logLoss,
  crossEntropy,
  regressionMetrics,
  fromMatrix,
  fromCounts,
  fromLabels,
];
