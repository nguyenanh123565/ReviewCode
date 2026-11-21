"""Write the Vietnamese delivery report only after all validation has passed."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def read(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


validation = read("validation.json")
dry = read("dry_run.json")
selection = read("selection.json")
sources = read("pr_sources.json")
assert validation["status"] == "pass" and validation["failed_checks"] == 0
assert dry["exit_code"] == 0 and dry["passed"] == 30 and dry["failed"] == 0

lines = [
    "# ReviewBench-VI: mở rộng từ 30 lên 60 item", "",
    "Ngày báo cáo: 2026-11-16 (Asia/Saigon).", "",
    "Đã tạo đủ 30 task mới và bộ 60 task. Các kiểm tra dưới đây đều có bằng chứng trong `corpus/vi/expansion_60_evidence/`.", "",
    "## Dữ liệu bàn giao", "",
    "- [additional_30_vi.json](../corpus/vi/additional_30_vi.json): 30 PR mới.",
    "- [pilot_60_vi.json](../corpus/vi/pilot_60_vi.json): đúng 30 item cũ, giữ nguyên thứ tự và giá trị, tiếp theo là 30 item mới.",
    "- Đường dẫn tuyệt đối: `E:/bench/ReviewBench/corpus/vi/additional_30_vi.json` và `E:/bench/ReviewBench/corpus/vi/pilot_60_vi.json`.", "",
    "Nguồn đã xác minh là [corpus/manifest.json](../corpus/manifest.json), gồm 219 task. Loại 30 cặp `(nwo, pr_number)` đã có trong pilot, còn 189 ứng viên; cả 189 có file Golden tương ứng. Chọn theo thứ tự manifest, một PR mỗi repository, body không rỗng và dài tối đa 3000 ký tự. Đây là ưu tiên chọn mẫu; các task dài, body rỗng hoặc cùng repo không bị kết luận là sai dữ liệu. Tiếp tục yêu cầu URL công khai thực sự trỏ tới PR và checkout/diff thành công trên môi trường Windows. Bốn ứng viên bị loại được ghi rõ bên dưới.", "",
    "## Validation", "",
    f"**PASS: {validation['passed_checks']} kiểm tra đạt, {validation['failed_checks']} lỗi.** [Kết quả máy đọc được](../corpus/vi/expansion_60_evidence/validation.json).", "",
    "- JSON hợp lệ theo `schema/corpus-manifest.schema.json`; đủ 30 mới và 60 tổng cộng; không trùng cặp `(nwo, pr_number)` trong bộ mới, giữa bộ cũ/mới hoặc trong bộ 60.",
    "- Mỗi item mới giữ đúng 13 field gốc; chỉ `title`/`body` có thể khác. `repo`, `pr_url`, `nwo`, `pr_number`, `base`, `head` và mọi số liệu metadata khớp nguồn.",
    "- Đối chiếu tự động từng title/body: code block nguyên vẹn, inline code, URL, số liệu và trạng thái checklist khớp theo thứ tự. Đã đọc và review độc lập đủ 30 bản dịch về tên hàm/biến/class/API/đường dẫn, điều kiện, phạm vi, ý nghĩa và trạng thái kiểm thử. Đây là review nội dung, không phải chứng minh hình thức về tương đương ngữ nghĩa. Ghi chú kỹ thuật mỗi PR và SHA-256 title/body nằm trong [translation_review.json](../corpus/vi/expansion_60_evidence/translation_review.json).",
    "- Code block tiếng Hoa, comment trong code, SQL/JSON/command và URL được giữ theo nguồn.",
    "- Cả 30 Golden được chọn có identity `repo`/`pr_number`/`base`/`head` khớp và SHA-256 không đổi. Không thêm Golden, finding hoặc đáp án vào hai manifest; runner chỉ nhận các field PR vốn có.",
    "- So với hash đầu phiên, toàn bộ `golden/`, `scripts/`, `examples/`, schema, manifest gốc và `pilot_30_vi.json` giữ nguyên. [Baseline SHA-256](../corpus/vi/expansion_60_evidence/baseline.json).",
    "- Cả 30 URL PR trả HTTP 200, kể cả chuyển hướng do đổi tên repository. Giữ nguyên toàn bộ identity/URL của snapshot manifest; không thay bằng SHA hoặc tên repo hiện tại. [Bằng chứng nguồn](../corpus/vi/expansion_60_evidence/pr_sources.json).", "",
    "SHA-256 của `pilot_30_vi.json` trước và sau: `6eb179c6f054d34e886e3adf280ee8bb94a87b3830ded1d3df615d90bb2c5d09`.", "",
    "## Dry-run", "",
    "```bash", "bash scripts/try-agent.sh unused-image \\",
    "  --manifest corpus/vi/additional_30_vi.json --dry-run", "```", "",
    "**passed 30, failed 0; exit code 0.** [Log nguyên văn](../corpus/vi/expansion_60_evidence/dry_run.log), [kết quả từng task](../corpus/vi/expansion_60_evidence/dry_run.json).", "",
    "Chạy runner hiện có bằng Git Bash trên Windows. Mỗi task fetch được base/head, checkout đúng head, tạo diff không rỗng và kiểm tra PR metadata. Mirror snapshot của ReviewBench là nguồn commit theo runner. Không chạy Docker, adapter, model hoặc Judge; không dùng API key. Wrapper loại biến API/token và tắt Git credential helper trước khi chạy. Không tạo PR hoặc commit.", "",
    "## 30 PR mới và nguồn từng task", "",
    "Chỉ số manifest dưới đây bắt đầu từ 0; mỗi dòng trỏ trực tiếp tới PR nguồn và Golden. Các đường dẫn này cũng nằm trong `validation.json`. Mọi dòng đều đạt validation và dry-run.", "",
    "| # | PR nguồn | Manifest gốc | Golden giữ nguyên | Diff (byte) |",
    "|---:|---|---|---|---:|",
]
for number, (item, run) in enumerate(zip(validation["tasks"], dry["tasks"]), 1):
    label = f"{item['nwo']}#{item['pr_number']}"
    golden_name = Path(item["golden"]).name
    lines.append(f"| {number} | [{label}]({item['source_pr']}) | `corpus/manifest.json[{item['manifest_index']}]` | [{golden_name}](../{item['golden']}) | {run['diff_bytes']} |")

lines += ["", "## Task bị loại hoặc thiếu Golden", "",
          "Không có task được chọn thiếu Golden. Các ứng viên sau có Golden nhưng không đưa vào bộ mới do không xác minh được PR công khai hoặc checkout không thành công:", ""]
for item in selection["excluded_unverified"]:
    lines.append(f"- [{item['nwo']}#{item['pr_number']}]({item['source_url']}), manifest index {item['manifest_index']}: `{item['error']}`.")
for item in selection.get("excluded_checkout", []):
    lines.append(f"- [{item['nwo']}#{item['pr_number']}]({item['source_url']}), manifest index {item['manifest_index']}: `{item['error']}`. [Log lỗi checkout](../{item['evidence']}). PR và Golden hợp lệ; task này không tương thích checkout trên Windows trong lượt chạy này.")
lines += ["", "Các task thay thế cuối cùng là `alexbol99/flatten-js#244` (index 52), `andresharpe/dotbot#131` (index 54) và `arolariu/arolariu.ro#615` (index 57), đã xác minh nguồn, Golden và dry-run. HTTP 404 không đủ để kết luận repo đã bị xóa hay chuyển sang riêng tư. URL `anokye-labs/kbexplorer/pull/38` trả HTTP 200 nhưng chuyển tới `/issues/38`, nên không được coi là PR đã xác minh. [Bằng chứng lượt chọn ban đầu](../corpus/vi/expansion_60_evidence/pr_sources_initial.json), [bằng chứng chuyển tới issue](../corpus/vi/expansion_60_evidence/pr_sources_replacement_55.json).", "",
          "Các PR còn lại ngoài mẫu chưa được kiểm tra tồn tại commit/PR qua mạng trong lượt này; không kết luận chúng không đủ điều kiện.", "",
          "## Chạy lại kiểm tra", "", "```bash",
          "python corpus/vi/expansion_60_evidence/validate.py", "```", "",
          "Validator dùng package `jsonschema` đã có trên môi trường và kiểm tra lại cả bằng chứng dry-run. Muốn fetch/chạy lại dry-run, dùng đúng lệnh Bash phía trên; không cần model hoặc API key.", ""]
for path, value in validation["output_sha256"].items():
    lines.append(f"- `{path}` SHA-256: `{value}`.")
lines.append("")
(ROOT / "docs/VI_EXPANSION_60.md").write_text("\n".join(lines), encoding="utf-8")
print("Wrote docs/VI_EXPANSION_60.md")
