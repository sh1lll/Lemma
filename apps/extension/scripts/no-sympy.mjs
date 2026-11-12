// The extension has no SymPy backend, so symbolic-engine's embedded Python program (PYTHON_SOURCE) is
// dead weight. Replacing it with an empty string keeps ~40 KB of Python, including its `eval(`, out of the
// bundles that store reviewers read.
export function noSympySource() {
  return {
    name: 'lemma-no-sympy-source',
    enforce: 'pre',
    load(id) {
      if (/symbolic-engine[\\/]src[\\/]python\.ts$/.test(id.split('?')[0])) return "export const PYTHON_SOURCE = '';\n";
      return null;
    },
  };
}
