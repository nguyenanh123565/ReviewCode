# ReviewBench-VI — pilot Task 0

ReviewBench-VI là thử nghiệm code review bằng tiếng Việt, hiện có đúng một task: `PierreJanineh/TechDebtMCP#135`. Pilot giữ nguyên repository, PR, base/head SHA và metadata kỹ thuật; chỉ dịch title/body của PR. Golden gốc không bị sửa và không được mount vào reviewer.

## Luồng dữ liệu

- `corpus/test/test.json`: nguồn tiếng Anh; Task 0 ở chỉ số `0`.
- `corpus/vi/test_vi.json`: manifest dịch một task. Provenance tiếng Anh nằm trong `translation`, nhưng runner chỉ chiếu các field PR cần thiết vào `pr.json`.
- `scripts/try-agent.sh`: lấy source ở đúng head, tạo `git diff base...head`, rồi mount source, metadata/diff read-only và output. Không mount Golden.
- `examples/codex-cli-vi/`: adapter dùng `codex exec` tổng quát, prompt theo ngôn ngữ, diff qua stdin, Codex sandbox read-only và output schema JSON.
- `AGENT_CONTRACT.md`: định nghĩa định dạng findings và frozen PR identity.

Adapter cố ý không dùng `codex exec review --base ... <PROMPT>`. Native review có quy tắc CLI riêng cho `--base`, `--commit`, `--title` và custom prompt. Thay vào đó, adapter truyền metadata/prompt positional, đồng thời gửi đúng diff `base...head` trên stdin. Đây là review tùy chỉnh bằng `codex exec`, không được coi là tương đương native review.

Trước model request, adapter kiểm tra version và `--help` thực tế của `codex exec`/`codex exec review`; guard argv từ chối native review/options để lỗi xung đột dừng trước API.

Codex phải trả JSON `{ "findings": [...] }` theo `review-response.schema.json`. Parser từ chối JSON lỗi, shape sai, đường dẫn không an toàn, dòng không hợp lệ hoặc field thiếu. Chỉ `{ "findings": [] }` hợp lệ mới biểu thị không có finding. Adapter ghi đúng `{ pr, agent, findings }` theo `AGENT_CONTRACT.md`.

## Kiểm tra offline

```sh
node scripts/validate-reviewbench-vi.mjs
bash -n scripts/try-agent.sh
scripts/try-agent.sh unused-image --set test --pr 0 --dry-run
scripts/try-agent.sh unused-image --manifest corpus/vi/test_vi.json --pr 0 --dry-run
```

Các lệnh trên không gọi model hoặc Judge. Dry-run xác minh chuẩn bị source/diff/metadata, không chứng minh image hay pipeline review chạy thành công.

## Audit log cho mỗi lượt

Mỗi lượt thật tạo thư mục riêng tại `./audit/<repo_PR_head>/run.<UTC timestamp>.<suffix>/`. Runner ghi `runner.json`, sau đó chép các file allowlist từ output mount trước khi xóa workspace tạm:

- `metadata.json`: PR/base/head, SHA-256 và kích thước diff/prompt, Codex CLI version, model, reasoning effort, trạng thái parser và hash/kích thước findings.
- `codex-response.json`: byte response nguyên trạng từ `codex exec --output-last-message`, được lưu trước khi parse.
- `findings.json`: output đã qua parser và validation theo `AGENT_CONTRACT.md`.
- `runner.json`: run ID, task identity, exit code container và danh sách artifact đã lưu.

Không ghi toàn bộ environment hoặc credentials. Nếu raw response chứa giá trị credential đã cấu hình hay mẫu API key/Bearer token, adapter giữ lỗi trong metadata đã redact và không lưu response đó. Chỉ file allowlist được chép khỏi workspace tạm. Có thể đổi thư mục gốc bằng `TRY_AGENT_AUDIT=/path/to/audit`.

Kiểm tra việc lưu raw response/parser và việc archive tồn tại sau cleanup bằng các lệnh offline:

```sh
node scripts/validate-reviewbench-vi.mjs
bash scripts/test-reviewbench-audit.sh
```

## Build và chạy cặp baseline Task 0

Khi Docker hoạt động và được phép dùng API:

```sh
docker build --platform linux/amd64 \
  -f examples/codex-cli-vi/Dockerfile \
  -t codex-cli-vi:dev examples/codex-cli-vi
```

Chạy hai lượt bằng cùng image, model, effort, endpoint và source SHA. Biến nghiên cứu là ngôn ngữ prompt/PR request (`en` hoặc `vi`):

```sh
scripts/try-agent.sh codex-cli-vi:dev --set test --pr 0 \
  -e OPENAI_API_KEY \
  -e RB_CONFIG_MODEL=gpt-5-mini \
  -e RB_CONFIG_EFFORT=medium \
  -e RB_CONFIG_REVIEW_LANGUAGE=en

scripts/try-agent.sh codex-cli-vi:dev --manifest corpus/vi/test_vi.json --pr 0 \
  -e OPENAI_API_KEY \
  -e RB_CONFIG_MODEL=gpt-5-mini \
  -e RB_CONFIG_EFFORT=medium \
  -e RB_CONFIG_REVIEW_LANGUAGE=vi
```

Không ghép native review tiếng Anh với custom `exec` tiếng Việt. Hai lượt trên cùng gọi `codex exec`, dùng cùng `--sandbox read-only`, schema, cấu hình model/effort, commit và bytes diff; prompt, title/body và ngôn ngữ output được đổi đồng bộ. Hãy xác nhận bản dịch giữ nguyên ý nghĩa trước khi diễn giải khác biệt. Một task/lượt đơn lẻ chưa đủ để kết luận hiệu quả ngôn ngữ vì model có thể biến thiên giữa các lần chạy.

## Evaluation và mở rộng

Judge là bước tách biệt; chưa chạy Judge trong validation offline. Nếu đánh giá correctness với Golden, giữ nguyên Golden và chỉ mount nó vào evaluator, không vào reviewer. Báo cáo riêng correctness, độ bao phủ finding và Vietnamese Compliance.

Chỉ mở rộng lên 5 task sau khi Docker image build/run được, cặp Task 0 English/Vietnamese đã qua kiểm tra thủ công về output và ý nghĩa bản dịch, findings vượt validator hợp đồng, model/config/SHA/diff được ghi lại đồng nhất, và không có lỗi bảo mật hoặc rò rỉ Golden. Trước đó không suy rộng kết quả dry-run thành kết quả benchmark.
