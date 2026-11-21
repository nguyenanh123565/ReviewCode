// Parse the structured response produced by `codex exec --output-schema`.
export function parseReview(raw, producer) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Codex response is not valid JSON");
  }
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.findings)) {
    throw new Error("Codex response must be an object containing only a findings array");
  }

  return value.findings.map((finding, index) => {
    const keys = ["priority", "file", "start_line", "end_line", "title", "explanation"];
    if (!isRecord(finding) || Object.keys(finding).sort().join(",") !== keys.sort().join(",")) {
      throw new Error(`Codex findings[${index}] has an invalid shape`);
    }
    if (!new Set(["P1", "P2", "P3"]).has(finding.priority) ||
        typeof finding.file !== "string" || !finding.file ||
        typeof finding.start_line !== "number" || !Number.isSafeInteger(finding.start_line) ||
        typeof finding.end_line !== "number" || !Number.isSafeInteger(finding.end_line) ||
        finding.start_line < 1 || finding.end_line < finding.start_line ||
        typeof finding.title !== "string" || !finding.title.trim() ||
        typeof finding.explanation !== "string" || !finding.explanation.trim()) {
      throw new Error(`Codex findings[${index}] has invalid field values`);
    }

    return {
      file: finding.file,
      start_line: finding.start_line,
      end_line: finding.end_line,
      message: `${finding.title.trim()}: ${finding.explanation.trim()}`,
      producer,
    };
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
