# ReviewBench-VI: mở rộng từ 30 lên 60 item

Ngày báo cáo: 2026-11-16 (Asia/Saigon).

Đã tạo đủ 30 task mới và bộ 60 task. Các kiểm tra dưới đây đều có bằng chứng trong `corpus/vi/expansion_60_evidence/`.

## Dữ liệu bàn giao

- [additional_30_vi.json](../corpus/vi/additional_30_vi.json): 30 PR mới.
- [pilot_60_vi.json](../corpus/vi/pilot_60_vi.json): đúng 30 item cũ, giữ nguyên thứ tự và giá trị, tiếp theo là 30 item mới.
- Đường dẫn tuyệt đối: `E:/bench/ReviewBench/corpus/vi/additional_30_vi.json` và `E:/bench/ReviewBench/corpus/vi/pilot_60_vi.json`.

Nguồn đã xác minh là [corpus/manifest.json](../corpus/manifest.json), gồm 219 task. Loại 30 cặp `(nwo, pr_number)` đã có trong pilot, còn 189 ứng viên; cả 189 có file Golden tương ứng. Chọn theo thứ tự manifest, một PR mỗi repository, body không rỗng và dài tối đa 3000 ký tự. Đây là ưu tiên chọn mẫu; các task dài, body rỗng hoặc cùng repo không bị kết luận là sai dữ liệu. Tiếp tục yêu cầu URL công khai thực sự trỏ tới PR và checkout/diff thành công trên môi trường Windows. Bốn ứng viên bị loại được ghi rõ bên dưới.

## Validation

**PASS: 686 kiểm tra đạt, 0 lỗi.** [Kết quả máy đọc được](../corpus/vi/expansion_60_evidence/validation.json).

- JSON hợp lệ theo `schema/corpus-manifest.schema.json`; đủ 30 mới và 60 tổng cộng; không trùng cặp `(nwo, pr_number)` trong bộ mới, giữa bộ cũ/mới hoặc trong bộ 60.
- Mỗi item mới giữ đúng 13 field gốc; chỉ `title`/`body` có thể khác. `repo`, `pr_url`, `nwo`, `pr_number`, `base`, `head` và mọi số liệu metadata khớp nguồn.
- Đối chiếu tự động từng title/body: code block nguyên vẹn, inline code, URL, số liệu và trạng thái checklist khớp theo thứ tự. Đã đọc và review độc lập đủ 30 bản dịch về tên hàm/biến/class/API/đường dẫn, điều kiện, phạm vi, ý nghĩa và trạng thái kiểm thử. Đây là review nội dung, không phải chứng minh hình thức về tương đương ngữ nghĩa. Ghi chú kỹ thuật mỗi PR và SHA-256 title/body nằm trong [translation_review.json](../corpus/vi/expansion_60_evidence/translation_review.json).
- Code block tiếng Hoa, comment trong code, SQL/JSON/command và URL được giữ theo nguồn.
- Cả 30 Golden được chọn có identity `repo`/`pr_number`/`base`/`head` khớp và SHA-256 không đổi. Không thêm Golden, finding hoặc đáp án vào hai manifest; runner chỉ nhận các field PR vốn có.
- So với hash đầu phiên, toàn bộ `golden/`, `scripts/`, `examples/`, schema, manifest gốc và `pilot_30_vi.json` giữ nguyên. [Baseline SHA-256](../corpus/vi/expansion_60_evidence/baseline.json).
- Cả 30 URL PR trả HTTP 200, kể cả chuyển hướng do đổi tên repository. Giữ nguyên toàn bộ identity/URL của snapshot manifest; không thay bằng SHA hoặc tên repo hiện tại. [Bằng chứng nguồn](../corpus/vi/expansion_60_evidence/pr_sources.json).

SHA-256 của `pilot_30_vi.json` trước và sau: `6eb179c6f054d34e886e3adf280ee8bb94a87b3830ded1d3df615d90bb2c5d09`.

## Dry-run

```bash
bash scripts/try-agent.sh unused-image \
  --manifest corpus/vi/additional_30_vi.json --dry-run
```

**passed 30, failed 0; exit code 0.** [Log nguyên văn](../corpus/vi/expansion_60_evidence/dry_run.log), [kết quả từng task](../corpus/vi/expansion_60_evidence/dry_run.json).

Chạy runner hiện có bằng Git Bash trên Windows. Mỗi task fetch được base/head, checkout đúng head, tạo diff không rỗng và kiểm tra PR metadata. Mirror snapshot của ReviewBench là nguồn commit theo runner. Không chạy Docker, adapter, model hoặc Judge; không dùng API key. Wrapper loại biến API/token và tắt Git credential helper trước khi chạy. Không tạo PR hoặc commit.

## 30 PR mới và nguồn từng task

Chỉ số manifest dưới đây bắt đầu từ 0; mỗi dòng trỏ trực tiếp tới PR nguồn và Golden. Các đường dẫn này cũng nằm trong `validation.json`. Mọi dòng đều đạt validation và dry-run.

| # | PR nguồn | Manifest gốc | Golden giữ nguyên | Diff (byte) |
|---:|---|---|---|---:|
| 1 | [ComposioHQ/agent-orchestrator#1277](https://github.com/ComposioHQ/agent-orchestrator/pull/1277) | `corpus/manifest.json[8]` | [ComposioHQ_agent-orchestrator_1277-76652c7c.json](../golden/ComposioHQ_agent-orchestrator_1277-76652c7c.json) | 22239 |
| 2 | [EdV4H/usketch#534](https://github.com/EdV4H/usketch/pull/534) | `corpus/manifest.json[10]` | [EdV4H_usketch_534-719aa834.json](../golden/EdV4H_usketch_534-719aa834.json) | 28219 |
| 3 | [EtienneLescot/n8n-as-code#295](https://github.com/EtienneLescot/n8n-as-code/pull/295) | `corpus/manifest.json[11]` | [EtienneLescot_n8n-as-code_295-c85d30b5.json](../golden/EtienneLescot_n8n-as-code_295-c85d30b5.json) | 32963 |
| 4 | [FreeRTOS/FreeRTOS-Kernel#1379](https://github.com/FreeRTOS/FreeRTOS-Kernel/pull/1379) | `corpus/manifest.json[12]` | [FreeRTOS_FreeRTOS-Kernel_1379-c926adcf.json](../golden/FreeRTOS_FreeRTOS-Kernel_1379-c926adcf.json) | 4152 |
| 5 | [Hermione-Granger-1176/artifacts#24](https://github.com/Hermione-Granger-1176/artifacts/pull/24) | `corpus/manifest.json[14]` | [Hermione-Granger-1176_artifacts_24-5d880a71.json](../golden/Hermione-Granger-1176_artifacts_24-5d880a71.json) | 1056322 |
| 6 | [JacobPEvans/ansible-splunk#120](https://github.com/JacobPEvans/ansible-splunk/pull/120) | `corpus/manifest.json[16]` | [JacobPEvans_ansible-splunk_120-252ddc57.json](../golden/JacobPEvans_ansible-splunk_120-252ddc57.json) | 11379 |
| 7 | [LegionIO/legion-interlink#16](https://github.com/LegionIO/legion-interlink/pull/16) | `corpus/manifest.json[17]` | [LegionIO_legion-interlink_16-c3dafce0.json](../golden/LegionIO_legion-interlink_16-c3dafce0.json) | 79413 |
| 8 | [LittleAndi/FileHorizon#19](https://github.com/LittleAndi/FileHorizon/pull/19) | `corpus/manifest.json[18]` | [LittleAndi_FileHorizon_19-958f48b3.json](../golden/LittleAndi_FileHorizon_19-958f48b3.json) | 47522 |
| 9 | [MatthewPeterKelly/fractal-renderer#163](https://github.com/MatthewPeterKelly/fractal-renderer/pull/163) | `corpus/manifest.json[21]` | [MatthewPeterKelly_fractal-renderer_163-0d3f5f18.json](../golden/MatthewPeterKelly_fractal-renderer_163-0d3f5f18.json) | 17798 |
| 10 | [Mirkiux/featkit#17](https://github.com/Mirkiux/featkit/pull/17) | `corpus/manifest.json[22]` | [Mirkiux_featkit_17-de0187b0.json](../golden/Mirkiux_featkit_17-de0187b0.json) | 30288 |
| 11 | [NKUST-ITC/NKUST-AP-Flutter#349](https://github.com/NKUST-ITC/NKUST-AP-Flutter/pull/349) | `corpus/manifest.json[24]` | [NKUST-ITC_NKUST-AP-Flutter_349-9586cd0a.json](../golden/NKUST-ITC_NKUST-AP-Flutter_349-9586cd0a.json) | 27336 |
| 12 | [NestDevLab/nestjs-yalc#123](https://github.com/NestDevLab/nestjs-yalc/pull/123) | `corpus/manifest.json[25]` | [NestDevLab_nestjs-yalc_123-3ce6ba57.json](../golden/NestDevLab_nestjs-yalc_123-3ce6ba57.json) | 127548 |
| 13 | [NightHawkATL/ntp-dashboard#84](https://github.com/NightHawkATL/ntp-dashboard/pull/84) | `corpus/manifest.json[26]` | [NightHawkATL_ntp-dashboard_84-2f4b8699.json](../golden/NightHawkATL_ntp-dashboard_84-2f4b8699.json) | 4471 |
| 14 | [Nixbug/entebus-web-executive#120](https://github.com/Nixbug/entebus-web-executive/pull/120) | `corpus/manifest.json[29]` | [Nixbug_entebus-web-executive_120-630b29d5.json](../golden/Nixbug_entebus-web-executive_120-630b29d5.json) | 44133 |
| 15 | [OpenDevicePartnership/embedded-services#793](https://github.com/OpenDevicePartnership/embedded-services/pull/793) | `corpus/manifest.json[30]` | [OpenDevicePartnership_embedded-services_793-f63a0246.json](../golden/OpenDevicePartnership_embedded-services_793-f63a0246.json) | 18967 |
| 16 | [PaulStSmith/PostmanOpenAPIConverter#7](https://github.com/PaulStSmith/PostmanOpenAPIConverter/pull/7) | `corpus/manifest.json[31]` | [PaulStSmith_PostmanOpenAPIConverter_7-41a95f20.json](../golden/PaulStSmith_PostmanOpenAPIConverter_7-41a95f20.json) | 3186 |
| 17 | [ROCm/TransferBench#256](https://github.com/ROCm/TransferBench/pull/256) | `corpus/manifest.json[35]` | [ROCm_TransferBench_256-1cfd8bd9.json](../golden/ROCm_TransferBench_256-1cfd8bd9.json) | 13989 |
| 18 | [Serapieum-of-alex/statista#130](https://github.com/Serapieum-of-alex/statista/pull/130) | `corpus/manifest.json[37]` | [Serapieum-of-alex_statista_130-31bd61f4.json](../golden/Serapieum-of-alex_statista_130-31bd61f4.json) | 77084 |
| 19 | [SiaFoundation/indexd#939](https://github.com/SiaFoundation/indexd/pull/939) | `corpus/manifest.json[38]` | [SiaFoundation_indexd_939-933dc46d.json](../golden/SiaFoundation_indexd_939-933dc46d.json) | 5101 |
| 20 | [T-K-233/Actuator-Control#7](https://github.com/T-K-233/Actuator-Control/pull/7) | `corpus/manifest.json[40]` | [T-K-233_Actuator-Control_7-87a346b7.json](../golden/T-K-233_Actuator-Control_7-87a346b7.json) | 7830 |
| 21 | [TrossenRobotics/trumi#7](https://github.com/TrossenRobotics/trumi/pull/7) | `corpus/manifest.json[41]` | [TrossenRobotics_trumi_7-65b522c8.json](../golden/TrossenRobotics_trumi_7-65b522c8.json) | 140897 |
| 22 | [Tzeusy/butlers#1021](https://github.com/Tzeusy/butlers/pull/1021) | `corpus/manifest.json[42]` | [Tzeusy_butlers_1021-403e15fe.json](../golden/Tzeusy_butlers_1021-403e15fe.json) | 16857 |
| 23 | [UniverseCitiz3n/msgraph-kb-mcp#2](https://github.com/UniverseCitiz3n/msgraph-kb-mcp/pull/2) | `corpus/manifest.json[45]` | [UniverseCitiz3n_msgraph-kb-mcp_2-3e0bfe72.json](../golden/UniverseCitiz3n_msgraph-kb-mcp_2-3e0bfe72.json) | 5720 |
| 24 | [VeyronSakai/UniCortex#162](https://github.com/VeyronSakai/UniCortex/pull/162) | `corpus/manifest.json[46]` | [VeyronSakai_UniCortex_162-e74a1d69.json](../golden/VeyronSakai_UniCortex_162-e74a1d69.json) | 113067 |
| 25 | [YasserShkeir/django-smart-ratelimit#25](https://github.com/YasserShkeir/django-smart-ratelimit/pull/25) | `corpus/manifest.json[49]` | [YasserShkeir_django-smart-ratelimit_25-d7c5c7c2.json](../golden/YasserShkeir_django-smart-ratelimit_25-d7c5c7c2.json) | 17410 |
| 26 | [ZhuoZhuoCrayon/throttled-py#135](https://github.com/ZhuoZhuoCrayon/throttled-py/pull/135) | `corpus/manifest.json[50]` | [ZhuoZhuoCrayon_throttled-py_135-94c7df60.json](../golden/ZhuoZhuoCrayon_throttled-py_135-94c7df60.json) | 16933 |
| 27 | [agent-sh/agentsys#298](https://github.com/agent-sh/agentsys/pull/298) | `corpus/manifest.json[51]` | [agent-sh_agentsys_298-a5224fae.json](../golden/agent-sh_agentsys_298-a5224fae.json) | 5764 |
| 28 | [alexbol99/flatten-js#244](https://github.com/alexbol99/flatten-js/pull/244) | `corpus/manifest.json[52]` | [alexbol99_flatten-js_244-2f55807e.json](../golden/alexbol99_flatten-js_244-2f55807e.json) | 7851 |
| 29 | [andresharpe/dotbot#131](https://github.com/andresharpe/dotbot/pull/131) | `corpus/manifest.json[54]` | [andresharpe_dotbot_131-cf5016a1.json](../golden/andresharpe_dotbot_131-cf5016a1.json) | 19010 |
| 30 | [arolariu/arolariu.ro#615](https://github.com/arolariu/arolariu.ro/pull/615) | `corpus/manifest.json[57]` | [arolariu_arolariu.ro_615-ef4814f4.json](../golden/arolariu_arolariu.ro_615-ef4814f4.json) | 83077 |

## Task bị loại hoặc thiếu Golden

Không có task được chọn thiếu Golden. Các ứng viên sau có Golden nhưng không đưa vào bộ mới do không xác minh được PR công khai hoặc checkout không thành công:

- [Nixbug/entebus-android-operator#67](https://github.com/Nixbug/entebus-android-operator/pull/67), manifest index 28: `HTTP Error 404: Not Found`.
- [RobertAgterhuis/myAgentic-IT-Project-team-V2#331](https://github.com/RobertAgterhuis/myAgentic-IT-Project-team-V2/pull/331), manifest index 36: `HTTP Error 404: Not Found`.
- [anokye-labs/kbexplorer#38](https://github.com/anokye-labs/kbexplorer/pull/38), manifest index 55: `HTTP 200 resolves to /issues/38 instead of /pull/38; public PR not verified`.
- [SpanPanel/span#207](https://github.com/SpanPanel/span/pull/207), manifest index 39: `Windows git checkout: invalid path '.github/instructions/*.instructions.md'`. [Log lỗi checkout](../corpus/vi/expansion_60_evidence/dry_run_attempt_1.log). PR và Golden hợp lệ; task này không tương thích checkout trên Windows trong lượt chạy này.

Các task thay thế cuối cùng là `alexbol99/flatten-js#244` (index 52), `andresharpe/dotbot#131` (index 54) và `arolariu/arolariu.ro#615` (index 57), đã xác minh nguồn, Golden và dry-run. HTTP 404 không đủ để kết luận repo đã bị xóa hay chuyển sang riêng tư. URL `anokye-labs/kbexplorer/pull/38` trả HTTP 200 nhưng chuyển tới `/issues/38`, nên không được coi là PR đã xác minh. [Bằng chứng lượt chọn ban đầu](../corpus/vi/expansion_60_evidence/pr_sources_initial.json), [bằng chứng chuyển tới issue](../corpus/vi/expansion_60_evidence/pr_sources_replacement_55.json).

Các PR còn lại ngoài mẫu chưa được kiểm tra tồn tại commit/PR qua mạng trong lượt này; không kết luận chúng không đủ điều kiện.

## Chạy lại kiểm tra

```bash
python corpus/vi/expansion_60_evidence/validate.py
```

Validator dùng package `jsonschema` đã có trên môi trường và kiểm tra lại cả bằng chứng dry-run. Muốn fetch/chạy lại dry-run, dùng đúng lệnh Bash phía trên; không cần model hoặc API key.

- `corpus/vi/additional_30_vi.json` SHA-256: `aa4fb8395c087f873244db2cc34a863562c0e0f6e1c978d75f9de5634a80e033`.
- `corpus/vi/pilot_60_vi.json` SHA-256: `2bb4a5af4ca6af77aaee2c16ba2a6c5cc5ead8213a1222550b677c465a146660`.
