// ====================================================================
// loop/notes.mjs — ⑥パッチノート生成。PATCHNOTES.md に新しい順で積む。
// ====================================================================

const MARKER = "<!-- AUTO-NOTES -->";
const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function buildNotes({ fromVersion, toVersion, diff, summary, stats, when }) {
  const date = when || new Date().toISOString().slice(0, 10);
  const lines = [`## v${toVersion} — ${date}`, ""];
  if (summary) lines.push(`> ${summary}`, "");
  lines.push("**変更**");
  for (const d of diff) {
    lines.push(
      d.kind === "balance"
        ? `- \`${d.path}\`: ${d.from} → ${d.to}`
        : `- \`${d.path}\`: 文言「${d.from}」→「${d.to}」`,
    );
  }
  if (stats) {
    lines.push("", `**判断材料** (v${fromVersion}, N=${stats.n}): ` +
      `難しすぎ ${pct(stats.hardRate)} / ちょうど良い ${pct(stats.justRate)} / 簡単すぎ ${pct(stats.easyRate)}`);
  }
  return lines.join("\n") + "\n";
}

export function prependNotes(existing, note) {
  const trimmed = note.trim();
  if (existing && existing.includes(MARKER)) {
    return existing.replace(MARKER, `${MARKER}\n\n${trimmed}`);
  }
  return `# 瞬発ラボ パッチノート\n\n_自律ループが自動生成（新しい順）。_\n\n${MARKER}\n\n${trimmed}\n${existing ? "\n" + existing : ""}`.trimEnd() + "\n";
}
