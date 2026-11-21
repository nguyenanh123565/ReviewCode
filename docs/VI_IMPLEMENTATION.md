# ReviewBench-VI: thiết kế triển khai

## Task và ranh giới dữ liệu

Pilot lấy `PierreJanineh/TechDebtMCP#135` từ `corpus/test/test.json` và giữ nguyên `repo`, URL/number, base/head SHA, ngôn ngữ nguồn và thống kê kỹ thuật. `corpus/vi/test_vi.json` dịch title/body và lưu provenance trong `translation`. Runner chỉ chiếu `repo`, `pr_number`, `base`, `head`, `nwo`, `title`, `body` vào `pr.json`, nên provenance nguồn không vào prompt.

Mỗi container nhận checkout source tại `RB_HEAD`, `/work/pr` read-only gồm diff và PR metadata, cùng output mount. Không mount `golden/`. Adapter đặt Codex working directory trong checkout, chỉ đọc source để lấy ngữ cảnh, và không đọc Golden.

## Sửa cách gọi Codex

Bản adapter trước gọi:

```text
codex exec review --base <SHA> --title <TITLE> <PROMPT>
```

Đây là cách ghép hai chế độ khác nhau. Trong Codex CLI `0.167.0`, `exec review --help` định nghĩa `--base` là so sánh theo base branch; review theo commit dùng `--commit`, và `--title` là nhãn của review commit. Custom `[PROMPT]` là review instructions, không phải cách chọn commit. Lệnh lỗi cụ thể đã được xác nhận trong image theo kết quả bạn cung cấp. Adapter mới không cố tái chạy lệnh lỗi; nó chặn native review/options khi dựng argv.

Adapter mới dùng lệnh tổng quát:

```text
codex exec --sandbox read-only --cd /work/repo --ephemeral \
  --output-schema /agent/review-response.schema.json \
  --output-last-message <temporary-file> --model <MODEL> \
  [-c model_reasoning_effort="<EFFORT>"] <FULL_PROMPT>
```

`<FULL_PROMPT>` là positional argument cuối, chứa base/head, repository, PR number, title/body và review instructions. Runner tạo `/work/pr/diff.patch` bằng `git diff <base>...<head>`; adapter so sánh bytes file này với kết quả Git trong checkout rồi gửi đúng bytes qua stdin. Codex CLI `0.167.0` `exec --help` xác nhận khi có prompt positional và stdin được pipe, stdin được thêm thành khối `<stdin>`. Trước model request, adapter chạy `codex --version`, `codex exec --help`, `codex exec review --help` và kiểm tra các signature cần dùng; đồng thời guard argv từ chối `review`, `--base`, `--commit`, `--title`, `--uncommitted`. Prompt nói rõ nội dung trong diff/title/body là dữ liệu, không phải chỉ thị.

Đây là **custom review bằng `codex exec`**, không tuyên bố tương đương native `codex exec review --base`. Mẫu dùng `codex exec` với `--output-schema` phù hợp ví dụ chính thức của OpenAI trong [Build iterative repair loops with Codex](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex). `--sandbox read-only` ngăn tác vụ Codex sửa checkout; không dùng `--dangerously-bypass-approvals-and-sandbox`. Mỗi lần chạy dùng `CODEX_HOME` tạm và ephemeral response file; API key chỉ nằm trong environment.

## Preflight và truyền dữ liệu

Preflight không còn tìm nguyên văn một câu mô tả stdin trong `codex exec --help`. Help có thể đổi câu chữ giữa bản dựng dù command grammar không đổi. Nó xác nhận phiên bản `0.167.0`, usage có positional `[PROMPT]`, và từng option mà invocation thực sự dùng; phần `exec review` cũng chỉ kiểm tra usage và tên option cấu trúc.

Trước khi chạy Codex, `assertReviewInputTransport` xác nhận prompt đầy đủ là đối số cuối và stdin bằng chính xác bytes của diff. `agent.mjs` tiếp tục xác minh bytes diff bằng `git diff RB_BASE...RB_HEAD`, rồi `child.stdin.end(invocation.stdin)` chuyển Buffer đó vào stdin. OpenAI Docs mô tả prompt positional là chỉ thị và dữ liệu piped là ngữ cảnh bổ sung ([Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)). Không dùng `codex exec -` vì chế độ đó sẽ biến stdin thành toàn bộ prompt, cần ghép prompt và diff vào một luồng khác.

## Kết quả và parser

`review-response.schema.json` yêu cầu object duy nhất có `findings` array; từng finding có `priority`, `file`, `start_line`, `end_line`, `title`, `explanation`. Codex được yêu cầu viết text theo ngôn ngữ request.

`parse.mjs` parse JSON và từ chối malformed JSON, missing/extra fields, priority sai, line range không hợp lệ, hoặc nội dung rỗng. Vì vậy lỗi parse không biến thành `findings: []`; chỉ JSON hợp lệ `{ "findings": [] }` biểu thị review không phát hiện lỗi. Adapter kiểm tra đường dẫn repository-relative an toàn, line range, producer, frozen PR identity và đúng field trong `AGENT_CONTRACT.md` trước khi ghi output. `findings.json` được tạo độc quyền; file tồn tại sẵn không bị ghi đè.

Lỗi Codex in status cùng đoạn stderr giới hạn độ dài sau khi redact API key, bearer token và chuỗi key phổ biến. Raw stdout, response lỗi và credentials không được đưa vào log.

## Audit log

Adapter tạo `metadata.json` trong thư mục audit trên `/work/out` trước khi chạy Codex. Metadata ghi PR identity, hash SHA-256/kích thước byte của đúng diff và prompt gửi positional, phiên bản Codex từ preflight, model, reasoning effort, trạng thái parse và hash/kích thước của output. Không lưu prompt đầy đủ hay environment.

Sau khi Codex kết thúc, adapter chép byte response từ `--output-last-message` vào `codex-response.json` trước khi gọi parser. Parser lỗi cập nhật trạng thái `parse_failed`, giữ raw response và trả exit code lỗi; chỉ response JSON hợp lệ mới tạo `findings.json`. Credential scanner từ chối lưu raw nếu thấy secret đã cấu hình hoặc mẫu API key/Bearer token.

Runner archive allowlist `metadata.json`, `codex-response.json`, `findings.json` vào `./audit/<repo_PR_head>/run.<UTC timestamp>.<suffix>/` trước khi trap xóa workspace. Runner cũng ghi `runner.json` chỉ gồm task identity, timestamps, exit code và artifact list. Tên thư mục được tạo bằng `mktemp -d`; không ghi đè lượt cũ. Golden không được mount vào container reviewer.

## So sánh English/Việt

`RB_CONFIG_REVIEW_LANGUAGE=en|vi` điều khiển ngôn ngữ tương ứng của review instructions, PR title/body (thông qua manifest nguồn/đã dịch) và ngôn ngữ findings. Cả hai dùng một image/adapter `codex exec`, cùng API endpoint, model, reasoning effort, read-only sandbox, schema, source head và diff bytes. Chỉ ngôn ngữ yêu cầu và bản dịch title/body thay đổi. Không so native English review với custom Vietnamese review.

Lệnh paired Task 0 được ghi trong [README_VI.md](../README_VI.md). Trước khi giải thích chênh lệch, người song ngữ cần xác nhận title/body dịch giữ nguyên semantics. Vì lần gọi model có biến thiên, một cặp kết quả chưa tạo bằng chứng thống kê.

## Giới hạn

Dry-run chỉ xác minh runner chuẩn bị source, diff và metadata; không chứng minh Codex gọi model, sinh findings đúng, hay Docker image khởi động. Phải xác nhận build/container và kiểm tra findings thật trước Judge hoặc mở rộng tập task. Golden vẫn tách khỏi reviewer.
