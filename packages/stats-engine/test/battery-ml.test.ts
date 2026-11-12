import { createSession, type Answer } from '@lemma/math-core';
import { describe, expect, it } from 'vitest';
import { Runtime } from '../../runtime/src';

// Data-science / ML math battery, run through the full router. Every expected value comes from an outside
// reference (scikit-learn documentation examples, Wikipedia worked examples, Quinlan's play-tennis data, Lindsay
// Smith's PCA tutorial, Matt Mazur's backpropagation walkthrough) or a closed form computed by hand / with
// Python's math module — never from this engine.

const rt = new Runtime();

async function run(q: string): Promise<Answer> {
  const o = await rt.compute(q, createSession(), { liveRates: false });
  if (o.kind !== 'answer') throw new Error(`"${q}" → ${o.kind}${o.kind === 'error' ? `: ${o.error.message}` : ''}`);
  return o.result;
}
const toNum = (s: string) => Number(s.replace(/,/g, '').replace(/−/g, '-').replace(/%$/, '').trim());

type Row = [input: string, label: string | null, expected: number | RegExp, tol?: number];

/** label null → primary value (or display for a RegExp); otherwise the first number in that detail line. */
async function check([q, label, expected, tol = 1e-5]: Row) {
  const a = await run(q);
  let shown: string;
  if (label === null) {
    if (typeof expected === 'number') {
      expect(a.value, `${q}: no value (${a.primary.display})`).toBeDefined();
      const v = a.value!.toNumber();
      expect(Math.abs(v - expected), `${q}: ${v} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));
      return;
    }
    shown = a.primary.display;
  } else {
    const l = a.lines?.find((x) => x.label.toLowerCase() === label.toLowerCase());
    expect(l, `${q}: no line "${label}" in ${JSON.stringify(a.lines?.map((x) => x.label))}`).toBeDefined();
    shown = l!.display;
  }
  if (expected instanceof RegExp) expect(shown, q).toMatch(expected);
  else {
    const m = /-?[\d,]*\.?\d+(?:e[-+]?\d+)?/i.exec(shown.replace(/−/g, '-'));
    const v = toNum(m ? m[0] : 'NaN');
    expect(Math.abs(v - expected), `${q} [${label}]: ${shown} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));
  }
}

async function asks(q: string, pattern: RegExp) {
  const o = await rt.compute(q, createSession(), { liveRates: false });
  expect(o.kind, q).toBe('error');
  if (o.kind === 'error') expect(o.error.message, q).toMatch(pattern);
}

const CM = 'tp 50 fp 10 fn 5 tn 100';

describe('classification metrics from counts', () => {
  it.each<Row>([
    // Hand: (50+100)/165
    [`confusion matrix ${CM}`, 'Accuracy', 150 / 165],
    [`confusion matrix ${CM}`, 'Precision', 50 / 60],
    [`confusion matrix ${CM}`, 'Recall (sensitivity)', 50 / 55],
    [`confusion matrix ${CM}`, 'Specificity', 100 / 110],
    [`confusion matrix ${CM}`, 'F1 score', 100 / 115],
    [`precision ${CM}`, null, 50 / 60],
    [`recall ${CM}`, null, 50 / 55],
    [`f1 score ${CM}`, null, 100 / 115],
    [`accuracy with ${CM}`, null, 150 / 165],
    [`specificity tp=50, fp=10, fn=5, tn=100`, null, 100 / 110],
    // MCC = (TP·TN − FP·FN)/√((TP+FP)(TP+FN)(TN+FP)(TN+FN)) (Matthews 1975; Python math)
    [`mcc ${CM}`, null, 0.8017837257372731],
    [`matthews correlation coefficient ${CM}`, null, 0.8017837257372731],
    // F-beta = (1+β²)PR/(β²P+R) (van Rijsbergen); Python math
    [`f2 score ${CM}`, null, 0.8928571428571429],
    [`f-beta beta 0.5 ${CM}`, null, 0.8474576271186441],
    [`balanced accuracy ${CM}`, null, 0.9090909090909091],
    [`npv ${CM}`, null, 100 / 105],
    [`false positive rate ${CM}`, null, 10 / 110],
    [`false negative rate ${CM}`, null, 5 / 55],
    [`confusion matrix ${CM}`, 'Prevalence', 55 / 165],
    // Cohen's kappa: po = 150/165, pe = (60·55 + 105·110)/165² → 0.8 (hand)
    [`cohen's kappa ${CM}`, null, 0.8],
    ['true positives 90 false positives 10 false negatives 30 true negatives 870 precision', null, 0.9],
    ['true positives 90 false positives 10 false negatives 30 true negatives 870 recall', null, 0.75],
    ['50 true positives, 10 false positives, 5 false negatives, 100 true negatives: f1', null, 100 / 115],
  ])('%s → %s', async (...r) => check(r));
});

describe('confusion matrices', () => {
  it.each<Row>([
    // 2×2 in scikit-learn layout [[TN, FP], [FN, TP]] (rows actual, columns predicted)
    ['confusion matrix [[100, 10], [5, 50]]', 'Accuracy', 150 / 165],
    ['confusion matrix [[100, 10], [5, 50]]', 'Precision', 50 / 60],
    ['confusion matrix [[100, 10], [5, 50]]', 'Recall (sensitivity)', 50 / 55],
    // Wikipedia "Cohen's kappa" worked example: 20 / 5 / 10 / 15 → κ = 0.4
    ["cohen's kappa [[20, 5], [10, 15]]", null, 0.4],
    ['kappa [[20, 5], [10, 15]]', 'Observed agreement', 0.7],
    ['kappa [[20, 5], [10, 15]]', 'Expected agreement', 0.5],
    // scikit-learn confusion_matrix doc example ([2,0,2,2,0,1] vs [0,0,2,2,0,2]) → [[2,0,0],[0,0,1],[1,0,2]]; accuracy 4/6
    ['confusion matrix [[2,0,0],[0,0,1],[1,0,2]]', 'Accuracy', 4 / 6],
    ['confusion matrix [[2,0,0],[0,0,1],[1,0,2]]', 'Macro recall', (1 + 0 + 2 / 3) / 3],
    ['confusion matrix [[2,0,0],[0,0,1],[1,0,2]]', 'Micro F1', 4 / 6],
  ])('%s → %s', async (...r) => check(r));
});

describe('metrics from label lists', () => {
  it.each<Row>([
    // scikit-learn accuracy_score doc: y_pred [0,2,1,3], y_true [0,1,2,3] → 0.5
    ['accuracy actual 0 1 2 3 predicted 0 2 1 3', null, 0.5],
    // scikit-learn classification_report doc: y_true [0,1,2,2,2], y_pred [0,0,2,2,1]
    ['classification report actual 0 1 2 2 2 predicted 0 0 2 2 1', 'Accuracy', 0.6],
    ['classification report actual 0 1 2 2 2 predicted 0 0 2 2 1', 'Macro precision', 0.5],
    ['classification report actual 0 1 2 2 2 predicted 0 0 2 2 1', 'Macro F1', (2 / 3 + 0 + 0.8) / 3],
    ['classification report actual 0 1 2 2 2 predicted 0 0 2 2 1', 'Weighted precision', 0.7],
    ['classification report actual 0 1 2 2 2 predicted 0 0 2 2 1', 'Weighted F1', (1 * 2 / 3 + 0 + 3 * 0.8) / 5],
    // scikit-learn f1_score doc: y_true [0,1,2,0,1,2], y_pred [0,2,1,0,0,1] → macro 0.2667, micro 0.3333
    ['macro f1 y_true 0 1 2 0 1 2 y_pred 0 2 1 0 0 1', null, 0.26666666666666666],
    ['micro f1 y_true 0 1 2 0 1 2 y_pred 0 2 1 0 0 1', null, 1 / 3],
    // scikit-learn precision_score doc (same data): macro 0.2222
    ['macro precision y_true 0 1 2 0 1 2 y_pred 0 2 1 0 0 1', null, 0.2222222222222222],
    // Binary: hand count TP 2 FP 1 FN 1 TN 1
    ['precision actual 1 0 1 1 0 predicted 1 0 0 1 1', null, 2 / 3],
    ['recall actual 1 0 1 1 0 predicted 1 0 0 1 1', null, 2 / 3],
    ['accuracy actual 1 0 1 1 0 predicted 1 0 0 1 1', null, 0.6],
  ])('%s → %s', async (...r) => check(r));
});

describe('ROC-AUC, log loss, cross-entropy', () => {
  it.each<Row>([
    // scikit-learn roc_auc_score doc: y [0,0,1,1], scores [0.1,0.4,0.35,0.8] → 0.75
    ['roc auc labels 0 0 1 1 scores 0.1 0.4 0.35 0.8', null, 0.75],
    ['auc y_true 0 0 1 1 y_score 0.1 0.4 0.35 0.8', null, 0.75],
    // Ties count ½ (Mann–Whitney): pos {0.5, 0.9} neg {0.5, 0.2} → (0.5+1+1+1)/4
    ['roc auc labels 0 1 0 1 scores 0.5 0.5 0.2 0.9', null, 0.875],
    // Perfect separation
    ['auc labels 0 0 0 1 1 scores 0.1 0.2 0.3 0.8 0.9', null, 1],
    // scikit-learn log_loss doc example (spam/ham) → 0.21616…
    ['log loss labels 1 0 0 1 probabilities 0.9 0.1 0.2 0.65', null, 0.21616187468057912],
    ['binary cross entropy y 1 0 0 1 p 0.9 0.1 0.2 0.65', null, 0.21616187468057912],
    // −ln 0.5
    ['log loss labels 1 0 probabilities 0.5 0.5', null, Math.LN2],
    // −ln 0.7 (categorical cross-entropy with the true class)
    ['cross entropy true class 3 probabilities 0.1 0.2 0.7', null, -Math.log(0.7)],
    ['cross entropy one-hot [0, 0, 1] predicted [0.1, 0.2, 0.7]', null, -Math.log(0.7)],
    // In bits: −log2 0.25 = 2
    ['cross entropy true class 1 probabilities 0.25 0.75 in bits', null, 2],
  ])('%s → %s', async (...r) => check(r));
});

describe('regression metrics', () => {
  // scikit-learn docs: y_true [3, -0.5, 2, 7], y_pred [2.5, 0.0, 2, 8]: MSE 0.375, MAE 0.5, R² 0.948608…, MAPE 0.327380…
  const D = 'actual 3 -0.5 2 7 predicted 2.5 0 2 8';
  it.each<Row>([
    [`mse ${D}`, null, 0.375],
    [`mean squared error ${D}`, null, 0.375],
    [`mae ${D}`, null, 0.5],
    [`rmse ${D}`, null, Math.sqrt(0.375)],
    [`mse ${D}`, 'R²', 0.9486081370449679],
    [`mape ${D}`, null, 32.73809523809524, 1e-5],
    [`r2 score mse ${D}`, 'RMSE', Math.sqrt(0.375)],
    // Hand: errors 1, -1, 2 → MSE 2, MAE 4/3
    ['mse y 1 2 3 yhat 2 1 5', null, 2],
    ['mae y 1 2 3 yhat 2 1 5', null, 4 / 3],
  ])('%s → %s', async (...r) => check(r));
});

describe('activations', () => {
  it.each<Row>([
    // softmax([1,2,3]) = e^k / Σ (Python math)
    ['softmax of 1 2 3', 'p3', 0.6652409557748219],
    ['softmax of 1 2 3', 'p1', 0.09003057317038045],
    ['softmax 1, 2, 3', 'p2', 0.24472847105479764],
    ['softmax of 1 2 3 temperature 2', 'p3', 0.506480391055654],
    // Equal logits → uniform
    ['softmax of 5 5 5 5', 'p1', 0.25],
    // σ(0) = 0.5, σ(2) = 0.880797…, σ(−1) = 0.268941…
    ['sigmoid(0)', null, 0.5],
    ['sigmoid of 2', null, 0.8807970779778823],
    ['logistic function of -1', null, 0.2689414213699951],
    ['sigmoid of 0 2 -1', 'σ(2)', 0.8807970779778823],
    ['relu of -2 0 3.5', 'relu(3.5)', 3.5],
    ['relu of -2 0 3.5', 'relu(-2)', 0],
    ['tanh activation of 0 0.5', 'tanh(0.5)', Math.tanh(0.5)],
  ])('%s → %s', async (...r) => check(r));
});

describe('decision-tree split gain', () => {
  it.each<Row>([
    // Quinlan (1986) play-tennis: H(9+,5−) = 0.940; Gain(Outlook) = 0.2467, Gain(Wind) = 0.048, Gain(Humidity) = 0.1518
    ['information gain parent 9 yes 5 no split [2 yes 3 no] [4 yes 0 no] [3 yes 2 no]', null, 0.24674981977443933],
    ['information gain parent [9, 5] children [6, 2] [3, 3]', null, 0.048127030408269544],
    ['information gain parent 9, 5 split 3, 4 | 6, 1', null, 0.15183550136234164],
    ['information gain parent [9, 5] children [6, 2] [3, 3]', 'Parent entropy', 0.9402859586706311],
    // Gini impurity 1 − Σp²: (9,5) → 0.459184; Gini gain of the wind split 0.030612
    ['gini impurity of 9 5', null, 0.4591836734693877],
    ['gini gain parent [9, 5] children [6, 2] [3, 3]', null, 0.030612244897959162],
    ['gini impurity of 5 5', null, 0.5],
    ['entropy split gain parent [8, 8] children [8, 0] [0, 8]', null, 1],
  ])('%s → %s', async (...r) => check(r));
});

describe('naive Bayes and kNN', () => {
  it.each<Row>([
    // Mitchell, Machine Learning (1997) §6.9 play-tennis: P(no | sunny, cool, high, strong) = 0.795
    ['naive bayes priors yes 9 no 5 likelihoods yes 2/9 3/9 3/9 3/9 no 3/5 1/5 4/5 3/5', 'P(no | x)', 0.795417348608838],
    ['naive bayes priors yes 9 no 5 likelihoods yes 2/9 3/9 3/9 3/9 no 3/5 1/5 4/5 3/5', null, /no/],
    // Gaussian NB, MLE variances (scikit-learn convention), equal priors: class a [1,2,3], b [6,7,8], x = 4 (Python math)
    ['gaussian naive bayes class a: 1 2 3 class b: 6 7 8 query 4', 'P(a | x)', 0.9770226300899744],
    // kNN by hand: (2,2) nearest to (1,1)a √2, (2,1)a 1, (1,2)a 1 → a
    ['knn k 3 class a: (1,1) (2,1) (1,2) class b: (5,5) (6,5) (5,6) query (2,2)', null, /\ba\b/],
    ['knn k 3 class a: (1,1) (2,1) (1,2) class b: (5,5) (6,5) (5,6) query (5,4)', null, /\bb\b/],
    // kNN regression: 2 nearest to 2.4 are 2 and 3 → (20+30)/2
    ['knn regression k 2 x 1 2 3 10 y 10 20 30 100 query 2.4', null, 25],
    // Manhattan distance |2−1|+|2−1| = 2 for (1,1)
    ['knn k 1 manhattan class a: (1,1) class b: (4,4) query (2,2)', null, /\ba\b/],
  ])('%s → %s', async (...r) => check(r));
});

describe('gradient descent and backprop', () => {
  it.each<Row>([
    // f'(x) = 2x − 4: 0 → 0.4 → 0.72 → 0.976 (hand)
    ['gradient descent on f(x) = x^2 - 4x from x = 0 learning rate 0.1 for 3 steps', null, 0.976],
    // f'(x) = 2x: 10 → 6 → 3.6
    ['gradient descent f(x) = x^2 x0 = 10 learning rate 0.2 2 steps', null, 3.6],
    // f(x) = x^3 − 3x, f' = 3x² − 3; from 2 with lr 0.1: 2 − 0.9 = 1.1
    ['gradient descent f(x)=x^3-3x starting at 2 lr 0.1 1 step', null, 1.1],
    // Linear regression, J = (1/n)Σ(ŷ − y)², w = b = 0, lr 0.1: dw = −56/3, db = −8 → w 1.8667, b 0.8
    ['gradient descent linear regression x 1 2 3 y 2 4 6 learning rate 0.1 1 iteration', 'w', 1.8666666666666667],
    ['gradient descent linear regression x 1 2 3 y 2 4 6 learning rate 0.1 1 iteration', 'b', 0.8],
    // Single sigmoid neuron, L = ½(a − t)²: z = 0.5, a = 0.622459, new w = 0.508872 (Python math)
    ['backprop single neuron x 1 w 0.5 b 0 target 1 learning rate 0.1', 'Output a', 0.6224593312018546],
    ['backprop single neuron x 1 w 0.5 b 0 target 1 learning rate 0.1', 'New w1', 0.5088723458674637],
    ['backprop single neuron x 1 w 0.5 b 0 target 1 learning rate 0.1', 'Loss', 0.07126847829827546],
    // Cross-entropy loss: ∂L/∂z = a − t → new w = 0.5 + 0.1·0.377541
    ['backprop single neuron cross entropy x 1 w 0.5 b 0 target 1 learning rate 0.1', 'New w1', 0.5377540668798145],
    // Matt Mazur, "A Step by Step Backpropagation Example" (2015): total error 0.298371109, w5⁺ 0.35891648, w1⁺ 0.149780716
    [
      'backprop inputs [0.05, 0.10] hidden weights [[0.15, 0.20], [0.25, 0.30]] hidden bias 0.35 output weights [[0.40, 0.45], [0.50, 0.55]] output bias 0.60 targets [0.01, 0.99] learning rate 0.5',
      'Total error',
      0.298371109,
    ],
    [
      'backprop inputs [0.05, 0.10] hidden weights [[0.15, 0.20], [0.25, 0.30]] hidden bias 0.35 output weights [[0.40, 0.45], [0.50, 0.55]] output bias 0.60 targets [0.01, 0.99] learning rate 0.5',
      'New output w11',
      0.35891648,
    ],
    [
      'backprop inputs [0.05, 0.10] hidden weights [[0.15, 0.20], [0.25, 0.30]] hidden bias 0.35 output weights [[0.40, 0.45], [0.50, 0.55]] output bias 0.60 targets [0.01, 0.99] learning rate 0.5',
      'New hidden w11',
      0.149780716,
    ],
  ])('%s → %s', async (...r) => check(r));
});

describe('regularisation', () => {
  it.each<Row>([
    // λΣw² and λΣ|w|
    ['l2 penalty weights 1 -2 3 lambda 0.1', null, 1.4],
    ['l1 penalty weights 1 -2 3 lambda 0.1', null, 0.6],
    ['l2 regularization term w = 0.5, -0.5 lambda 2', null, 1],
    // Ridge with unpenalised intercept: centred x [-1,0,1], y [-2,0,2] → w = 4/(2+1), b = 4 − 2w
    ['ridge regression x 1 2 3 y 2 4 6 lambda 1', 'Slope', 4 / 3],
    ['ridge regression x 1 2 3 y 2 4 6 lambda 1', 'Intercept', 4 / 3],
    // λ = 0 is ordinary least squares: y = 2x
    ['ridge regression x 1 2 3 y 2 4 6 lambda 0', 'Slope', 2],
  ])('%s → %s', async (...r) => check(r));
});

describe('model size, FLOPs, perplexity', () => {
  it.each<Row>([
    // bytes/param: fp32 4, fp16/bf16 2, int8 1, int4 0.5 (decimal GB)
    ['memory for 7B parameters at fp16', null, 14],
    ['7 billion parameters in int8 memory', null, 7],
    ['70b params fp32 memory', null, 280],
    ['13B parameters int4 memory', null, 6.5],
    ['memory for 7B parameters at fp16', 'GiB', 14e9 / 2 ** 30],
    ['how much memory does a 1.5B parameter model need in bf16', null, 3],
    // Kaplan et al. 2020: training C ≈ 6ND; inference ≈ 2N per token
    ['training flops 7B parameters 2T tokens', null, 8.4e22],
    ['inference flops per token for 7B parameters', null, 1.4e10],
    // GPT-2 small: 12·L·d² + V·d = 12·12·768² + 50257·768 = 123,532,032 (≈124M reported)
    ['transformer parameters 12 layers d_model 768 vocab 50257', null, 123532032],
    // PPL = e^H (nats), 2^H (bits); geometric mean of 1/p
    ['perplexity cross entropy 2 nats', null, Math.exp(2)],
    ['perplexity from cross-entropy 3 bits', null, 8],
    ['perplexity of token probabilities 0.25 0.5 0.125', null, 4],
  ])('%s → %s', async (...r) => check(r));
});

describe('PCA, k-means, factor analysis', () => {
  const SMITH =
    'pca\nx,y\n2.5,2.4\n0.5,0.7\n2.2,2.9\n1.9,2.2\n3.1,3.0\n2.3,2.7\n2,1.6\n1,1.1\n1.5,1.6\n1.1,0.9';
  it.each<Row>([
    // Lindsay Smith, "A tutorial on Principal Components Analysis" (2002): eigenvalues 1.28402771, 0.0490833989
    [SMITH, 'λ1', 1.28402771],
    [SMITH, 'λ2', 0.0490833989],
    [SMITH, null, 1.28402771 / (1.28402771 + 0.0490833989)],
    // Covariance [[4,2],[2,3]]: λ = (7 ± √17)/2
    ['pca covariance matrix [[4, 2], [2, 3]]', 'λ1', (7 + Math.sqrt(17)) / 2],
    ['pca covariance matrix [[4, 2], [2, 3]]', null, (7 + Math.sqrt(17)) / 2 / 7],
    ['principal component analysis covariance [[2, 0], [0, 1]]', 'λ2', 1],
    // k-means on 1-D clusters: centroids 2 and 11, WCSS 2 + 2
    ['k-means k=2 points 1 2 3 10 11 12', 'Within-cluster SS', 4],
    ['k-means k=2 points 1 2 3 10 11 12', 'Centroid 1', 2],
    // 2-D with given initial centroids: centroids (4/3, 4/3), (25/3, 25/3); WCSS 12/9 · 2
    ['kmeans k 2 points (1,1) (1,2) (2,1) (8,8) (9,8) (8,9) initial centroids (1,1) (8,8)', 'Within-cluster SS', 24 / 9],
    ['kmeans k 2 points (1,1) (1,2) (2,1) (8,8) (9,8) (8,9) initial centroids (1,1) (8,8)', 'Centroid 2', 25 / 3],
    // One factor from R = [[1, .6], [.6, 1]] (principal components): λ = 1.6, loadings √0.8, communality 0.8
    ['factor analysis 1 factor correlation matrix [[1, 0.6], [0.6, 1]]', 'Communality 1', 0.8],
    ['factor analysis 1 factor correlation matrix [[1, 0.6], [0.6, 1]]', 'Loading 1', Math.sqrt(0.8)],
    ['factor analysis 1 factor correlation matrix [[1, 0.6], [0.6, 1]]', 'Uniqueness 1', 0.2],
  ])('%s → %s', async (...r) => check(r));
});

describe('asks instead of guessing', () => {
  it.each<[string, RegExp]>([
    ['precision tp 50', /false positives|fp/i],
    ['roc auc labels 0 1 1 scores 0.2 0.4', /same number|lengths?|match/i],
    ['log loss labels 1 0 probabilities 1.5 0.2', /between 0 and 1/i],
    ['k-means points 1 2 3 10 11 12', /how many clusters|k/i],
    ['auc labels 1 1 1 scores 0.2 0.4 0.5', /both classes|negative/i],
  ])('%s', async (q, p) => asks(q, p));
});

describe('leaves other questions alone', () => {
  it.each<[string, string]>([
    ['tanh(0.5)', 'calc'],
    ['what is the accuracy of 3.14 vs pi', 'not-ml'],
  ])('%s', async (q, kind) => {
    const o = await rt.compute(q, createSession(), { liveRates: false });
    if (kind === 'calc') expect(o.kind).toBe('calc');
    else if (o.kind === 'answer') expect(o.result.expression).not.toMatch(/confusion|classification/i);
  });
});
