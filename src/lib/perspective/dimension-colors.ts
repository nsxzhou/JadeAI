/**
 * 维度配色：题目列表里的小圆点和详情里的标签共用一套色，
 * 扫一眼列表就知道哪几道是同类题。
 *
 * Tailwind 不能拼接类名，只能把完整类名写死在表里。
 *
 * 配色表覆盖内核目录里的全部 key（含旧的 7 个，老数据仍能取到稳定颜色）。
 * 要求是「同一场面试里出现的维度彼此不同色」——一场最多 4 条通用层 + 4 条族层，
 * 所以每个岗位族的 8 色组合都刻意错开了色相。
 */
export interface DimensionColor {
  /** 列表里的小圆点 */
  dot: string;
  /** 详情里的维度标签 */
  chip: string;
}

function color(dot: string, chip: string): DimensionColor {
  return { dot, chip };
}

const PRESET_COLORS: Record<string, DimensionColor> = {
  // ── 通用层 ──
  general_communication: color(
    'bg-sky-500',
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
  ),
  general_logic: color(
    'bg-violet-500',
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300',
  ),
  general_stress: color(
    'bg-amber-500',
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  ),
  general_learning: color(
    'bg-emerald-500',
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  ),

  // ── 族层：后端 ──
  go_fundamentals: color(
    'bg-cyan-600',
    'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-300',
  ),
  backend_fundamentals: color(
    'bg-blue-500',
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  ),
  middleware_database: color(
    'bg-indigo-500',
    'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300',
  ),
  project_deep_dive: color(
    'bg-rose-500',
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
  ),
  system_scenario: color(
    'bg-teal-500',
    'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300',
  ),

  // ── 族层：前端 ──
  frontend_fundamentals: color(
    'bg-fuchsia-500',
    'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  ),
  browser_network: color(
    'bg-purple-500',
    'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300',
  ),
  engineering_practice: color(
    'bg-lime-600',
    'border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300',
  ),

  // ── 族层：数据 / 算法 ──
  data_processing: color(
    'bg-orange-500',
    'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300',
  ),
  algorithm_complexity: color(
    'bg-pink-500',
    'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950 dark:text-pink-300',
  ),
  metrics_experiment: color(
    'bg-yellow-600',
    'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-300',
  ),

  // ── 族层：测试 / 基础设施 ──
  testing_strategy: color(
    'bg-green-600',
    'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  ),
  cicd_delivery: color(
    'bg-slate-600',
    'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-900 dark:bg-slate-950 dark:text-slate-300',
  ),
  observability_incident: color(
    'bg-red-500',
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  ),

  // ── 反问环节 ──
  candidate_questions: color(
    'bg-zinc-500',
    'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  ),

  // ── 旧目录里剩下的两个题型：颜色跟随它们归并到的通用层维度 ──
  communication_pressure: color(
    'bg-amber-500',
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  ),
  hr_motivation: color(
    'bg-sky-500',
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
  ),
};

/** 自定义维度从这里取色。和预置色错开，避免一眼看去像某个预置维度。 */
const FALLBACK_COLORS: DimensionColor[] = [
  color(
    'bg-lime-500',
    'border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300',
  ),
  color(
    'bg-cyan-500',
    'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-300',
  ),
  color(
    'bg-blue-400',
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  ),
  color(
    'bg-pink-400',
    'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950 dark:text-pink-300',
  ),
];

/**
 * 同一个 key 永远得到同一个颜色——自定义维度靠 key 的哈希取色，
 * 不能用数组下标，不然删掉一个维度后剩下的全部换色。
 */
export function dimensionColor(key: string): DimensionColor {
  const preset = PRESET_COLORS[key];
  if (preset) return preset;

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}
