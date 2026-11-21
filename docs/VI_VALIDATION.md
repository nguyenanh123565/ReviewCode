# ReviewBench-VI: kiểm tra pilot Task 0

Ngày chạy: 2026-11-12. Không chạy Judge, không mở rộng Dataset và không có kết quả review từ model. Các dry-run chỉ chuẩn bị checkout/diff/metadata.

## PASS

- **Schema và parity** — `node scripts/validate-reviewbench-vi.mjs` xác nhận manifest tiếng Anh và `corpus/vi/test_vi.json` theo schema; Task 0 khớp repository, PR, base/head SHA và metadata kỹ thuật; title/body Việt hóa và provenance đối chiếu nguyên văn.
- **Lệnh adapter** — helper dựng `codex exec` tổng quát với prompt đầy đủ ở positional argument cuối, diff bytes qua stdin, `--sandbox read-only`, model/effort và `--output-schema`. Không còn `exec review`, `--base` hay `--title` trong invocation.
- **Syntax preflight thật** — CLI cài trên host trả `codex-cli 0.167.0`; chạy trực tiếp `codex --version`, `codex exec --help` và `codex exec review --help` trong `CODEX_HOME` tạm, không có credentials, xác nhận signature/version dự kiến. Preflight runtime kiểm tra lại các help này trước lượt model; guard argv từ chối tổ hợp native review/prompt cũ. Validator có fixture help và regression case cho argv cũ.
- **Parser và contract** — fixture tiếng Việt giữ nguyên Unicode/path/dòng/producer; fixture `{ "findings": [] }` hợp lệ; malformed JSON và thiếu `findings` bị từ chối. Output được kiểm tra theo `{ pr, agent, findings }` và field của finding trong `AGENT_CONTRACT.md`. Diagnostic giữ thông tin lỗi, đồng thời redact API key/Bearer token.
- **Cô lập Golden** — runner chỉ mount checkout, `/work/pr:ro` và output; `pr.json` chỉ chứa field PR cần thiết. Không có mount hay tham chiếu Golden trong adapter.
- **Bảo toàn dữ liệu nguồn** — `git status` xác nhận `corpus/test/test.json`, `corpus/manifest.json` và `golden/` không có thay đổi trong working tree.
- **Cú pháp source** — `node --check` cho adapter, CLI preflight, parser, prompt, diagnostic và validator; `bash -n scripts/try-agent.sh`; `git diff --check` đều thành công.
- **Dry-run tiếng Anh Task 0** — `--set test --pr 0 --dry-run`: 1 passed, 0 failed; `HEAD=16a54f0f85a9091f220418850eac6b4122782be5`, `base=ea0385c7349bbaee04456c57bf0ec3f217d63532`, diff `22,824` bytes.
- **Dry-run tiếng Việt Task 0** — `--manifest corpus/vi/test_vi.json --pr 0 --dry-run`: 1 passed, 0 failed; cùng HEAD, base và diff `22,824` bytes.
- **Build command** — Docker CLI help xác nhận `build`, `--platform`, `-f` và `-t`; Dockerfile pin `@openai/codex@0.167.0` và copy JSON output schema.

Validator offline hiện báo **25 PASS, 0 FAIL, 1 NOT VERIFIED** khi không truyền `--repo`; mục chưa xác minh là Git object/diff trong chính validator. Dry-run Task 0 đã được ghi nhận riêng ở trên. Bài archive shell trước đó đã PASS; lượt chạy hiện tại không khởi chạy được Bash do Windows trả `Bash/Service/CreateInstance/E_ACCESSDENIED`, nên chưa chạy lại bài này.

## Audit logging bổ sung

- Lỗi mới nhất là false negative của preflight: `cli-preflight.mjs` yêu cầu nguyên văn một câu mô tả stdin từ `codex exec --help`. Đây không phải lỗi cú pháp invocation. Preflight nay kiểm tra đúng version, usage có positional `PROMPT` và các option bằng token cấu trúc; test với help wording thay thế PASS, còn help thiếu option bắt buộc FAIL.
- `prompt.mjs` giữ nguyên phương thức truyền: prompt đầy đủ ở đối số cuối, byte diff ở stdin. `assertReviewInputTransport` kiểm tra hai đầu vào không bị thiếu/thay thế; test kiểm tra Buffer diff khớp byte-for-byte và từ chối prompt/diff bị đổi. OpenAI Docs mô tả positional prompt là instruction, piped stdin là context bổ sung.
- Host Codex CLI trực tiếp báo `codex-cli 0.167.0`; `codex exec --help` xác nhận positional `[PROMPT]`, `--output-schema`, `--output-last-message` và prompt-plus-piped-stdin. Không gọi model trong bước kiểm tra help.
- Docker Engine hiện từ chối named pipe khi đọc lại help từ image, nên lần preflight trong container sau sửa là **NOT VERIFIED** ở lượt này. Bản test offline dùng fixture 0.167.0 và kiểm tra riêng việc thiếu usage/option.
- Adapter ghi nguyên byte `--output-last-message` vào `codex-response.json` trước `parseReview`; metadata ghi PR/base/head, hash và byte length của diff/prompt, Codex CLI version, model, reasoning effort, trạng thái parse và hash/kích thước findings. Metadata không chứa nội dung prompt hoặc environment.
- Runner dùng thư mục duy nhất `./audit/<repo_PR_head>/run.<UTC timestamp>.<suffix>/`, chép allowlist trước khi trap xóa `.try-agent/runs/...`, rồi ghi `runner.json`. Audit gốc có thể đổi bằng `TRY_AGENT_AUDIT`.
- Offline tests: `node scripts/validate-reviewbench-vi.mjs` bao gồm raw response có finding, `{ "findings": [] }`, parser failure còn raw, hash/kích thước và guard credential; `bash scripts/test-reviewbench-audit.sh` xác minh metadata/raw/findings còn nguyên sau cleanup scratch và từ chối ghi đè.
- Lượt container thành công chỉ được xem là đã lưu đủ audit nếu cả `metadata.json`, `codex-response.json`, `findings.json` được archive. Với parse lỗi, metadata/raw vẫn được archive và ghi rõ `parse_failed`; không sinh findings rỗng.

## NOT VERIFIED

- **Docker image/container** — context là `desktop-linux`; `docker info --format '{{.ServerVersion}}'` trả `permission denied` với pipe `npipe:////./pipe/dockerDesktopLinuxEngine`. Vì vậy không chạy `docker build`, không có image `codex-cli-vi:dev` đã xác minh và chưa thử adapter trong container.
- **Model response thật** — chưa xác minh Codex trả output theo JSON Schema, findings thực tế, giới hạn sandbox trong Docker hay ngôn ngữ output khi chạy model.

## Chẩn đoán Docker đã có

- Docker CLI `29.8.1` chọn endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`. `docker info` bị từ chối và Docker Desktop không sẵn sàng; build trước đó cũng không kết nối được Engine.
- Agent chạy dưới `desktop-l91h3gv\admin`; token không elevated (Administrators là `deny-only`, không có `docker-users`). ACL thư mục log cho thấy account có quyền FullControl nên chưa đủ bằng chứng kết luận do quyền NTFS.
- Cài đặt Docker nằm dưới `%LOCALAPPDATA%\Programs\DockerDesktop`, phù hợp per-user install. Thiếu `com.docker.service`/`docker-users` không tự nó chứng minh lỗi với backend WSL 2.
- WSL 3.0.5.0/kernel 6.1.58.1-1 liệt kê Ubuntu và `docker-desktop`, cả hai đang `Stopped`. Có cảnh báo WSL NAT `172.17.112.0/20` trùng Docker default network; chưa chứng minh đây là nguyên nhân named-pipe.
- Không sửa ACL, nhóm Windows, Docker configuration, `.wslconfig` hoặc cài đặt WSL.

## Lệnh chạy cặp Task 0 khi Docker/API sẵn sàng

Build image:

```sh
docker build --platform linux/amd64 \
  -f examples/codex-cli-vi/Dockerfile \
  -t codex-cli-vi:dev examples/codex-cli-vi
```

English baseline:

```sh
scripts/try-agent.sh codex-cli-vi:dev --set test --pr 0 \
  -e OPENAI_API_KEY -e RB_CONFIG_MODEL=gpt-5-mini \
  -e RB_CONFIG_EFFORT=medium -e RB_CONFIG_REVIEW_LANGUAGE=en
```

Vietnamese pilot:

```sh
scripts/try-agent.sh codex-cli-vi:dev --manifest corpus/vi/test_vi.json --pr 0 \
  -e OPENAI_API_KEY -e RB_CONFIG_MODEL=gpt-5-mini \
  -e RB_CONFIG_EFFORT=medium -e RB_CONFIG_REVIEW_LANGUAGE=vi
```

Hai lệnh dùng cùng image/method/model/effort/endpoint và Task 0 base/head/diff. Khác biệt có chủ đích là ngôn ngữ prompt cùng title/body đã dịch. Chưa được so kết quả này với native Codex review tiếng Anh.
