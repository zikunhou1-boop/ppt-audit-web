import fs from "fs";
import path from "path";

function readRules() {
  const p = path.join(process.cwd(), "rules", "rules.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function toRegExpSafe(s) {
  // 对于直接给“词”的 patterns，我们当作普通包含判断；若你未来要真正regex，可扩展字段 is_regex
  return s;
}

function includesAny(text, arr = []) {
  return arr.some((x) => x && text.includes(x));
}
function includesAll(text, arr = []) {
  return arr.every((x) => x && text.includes(x));
}

function runAudit(pages, rulesDoc) {
  const rules = rulesDoc.rules || [];
  const issues = [];

  const pageTexts = (pages || []).map((p, idx) => ({
    page: Number.isFinite(p.page) ? p.page : idx + 1,
    text: String(p.content || "")
  }));

  const fullText = pageTexts.map((p) => p.text).join("\n\n");

  // 逐页类规则
  for (const r of rules) {
    const type = r.type;

    if (type === "forbidden_patterns") {
      for (const p of pageTexts) {
        for (const pat of (r.patterns || [])) {
          const needle = toRegExpSafe(pat);
          if (needle && p.text.includes(needle)) {
            issues.push({
              page: p.page,
              rule_id: r.id,
              excerpt: needle,
              reason: r.title,
              suggestion: r.instruction || "请按规则整改"
            });
            break;
          }
        }
      }
    }

    if (type === "must_have_if_contains") {
      // 条件规则：如果全文/页内出现 if_patterns_any，则必须包含 must_patterns_any
      const trigger = includesAny(fullText, r.if_patterns_any || []);
      if (trigger) {
        const ok = includesAny(fullText, r.must_patterns_any || []);
        if (!ok) {
          issues.push({
            page: 0,
            rule_id: r.id,
            excerpt: (r.if_patterns_any || [])[0] || "",
            reason: r.title,
            suggestion: r.instruction || "请按规则补齐/整改"
          });
        }
      }
    }
  }

  // 文档级必备项规则（must_have_any / must_have_all）
  for (const r of rules) {
    const type = r.type;

    if (type === "must_have_any") {
      const ok = includesAny(fullText, r.patterns_any || []);
      if (!ok) {
        issues.push({
          page: 0,
          rule_id: r.id,
          excerpt: (r.patterns_any || []).slice(0, 3).join(" / "),
          reason: r.title,
          suggestion: r.instruction || "请按规则补齐"
        });
      }
    }

    if (type === "must_have_all") {
      const okAll = includesAll(fullText, r.patterns_all || []);
      const okAny = !r.patterns_any || includesAny(fullText, r.patterns_any || []);
      if (!okAll || !okAny) {
        issues.push({
          page: 0,
          rule_id: r.id,
          excerpt: "缺少必要声明/要素",
          reason: r.title,
          suggestion: r.instruction || "请按规则补齐"
        });
      }
    }
  }

  const severityOf = (id) => (rules.find((x) => x.id === id)?.severity || "low");
  const risk_level = issues.some((x) => severityOf(x.rule_id) === "high")
    ? "high"
    : issues.length
    ? "medium"
    : "low";

  return {
    pass: issues.length === 0,
    risk_level,
    rule_version: rulesDoc.version,
    issues
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { pages } = req.body || {};
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: "pages is required" });
  }

  const rulesDoc = readRules();
  const out = runAudit(pages, rulesDoc);
  return res.status(200).json(out);
}
