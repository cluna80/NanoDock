/**
 * DockingAgent — runs AutoDock Vina via the Python shim (or mock mode).
 */
import { spawn } from 'node:child_process';

export interface DockRequest {
  smiles: string;
  target: string;
}

export interface DockResult {
  smiles: string;
  target: string;
  affinity_kcal_mol: number;
  pose_pdb: string | null;
  runtime_s: number;
  backend: string;
}

export async function runDock(req: DockRequest): Promise<DockResult> {
  // Mock mode: return realistic-looking affinities without Python
  if (process.env.USE_MOCK_DOCKING === 'true') {
    // Generate a plausible affinity between -12 and -5 kcal/mol
    const affinity = -5 - (Math.random() * 7);
    return {
      smiles: req.smiles,
      target: req.target,
      affinity_kcal_mol: affinity,
      pose_pdb: null,
      runtime_s: 0.05,
      backend: 'mock'
    };
  }

  // Real mode: call Python bridge
  const python = process.env.PYTHON_PATH ?? process.env.PYTHON_BIN ?? 'python3';
  const script = new URL('../docking/vina_bridge.py', import.meta.url).pathname;

  return new Promise((resolve, reject) => {
    const proc = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`vina_bridge exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e: any) {
        reject(new Error(`bad vina_bridge output: ${e.message}\n${stdout}`));
      }
    });
    proc.stdin.write(JSON.stringify(req));
    proc.stdin.end();
  });
}
