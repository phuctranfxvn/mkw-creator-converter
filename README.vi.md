# MakerWorld to Creator 5

Chuyển file `.3mf` tải từ MakerWorld (project của Bambu Studio) thành project mà
Orca-Flashforge mở được cho máy Flashforge Creator 5.

Toàn bộ xử lý chạy trong trình duyệt. Không có server, không file nào rời khỏi máy bạn.

Giao diện có tiếng Việt và tiếng Anh, đổi ở góc trên bên phải.
English documentation: [README.md](README.md).

![Trang web sau khi chuyển xong một file: ô kéo thả và tuỳ chọn bên trái, thẻ kết quả bên phải](screenshots/1-homepage.png)

---

## Chạy thử

```bash
npm install          # chỉ cần cho test; trang web không phụ thuộc npm khi chạy
npm start            # http://localhost:5173
```

Trang web là HTML/CSS/JS tĩnh. Muốn deploy thì copy nguyên thư mục lên bất kỳ
static host nào (GitHub Pages, Netlify, Cloudflare Pages). Không cần build step.

## Giao diện

Hai cột: bên trái là ô kéo thả, hàng chờ và tuỳ chọn; bên phải là kết quả, dính
theo cuộn, file mới nhất nằm trên cùng. Thả file vào chỉ đưa vào hàng chờ, không
chuyển đổi gì cho tới khi bấm Chuyển đổi, để còn kịp chỉnh tuỳ chọn trước. Mỗi
thẻ kết quả có nút *Chuyển đổi lại* chạy lại đúng file đó với tuỳ chọn hiện tại,
khỏi phải kéo thả lần nữa.

![Bảng tuỳ chọn: máy đích, mức chuyển đổi và mức độ đẹp](screenshots/2-options.png)

## Nó đổi những gì

File 3MF là một file zip. Một project MakerWorld chứa hình học, cách sắp xếp
trên bàn in, và toàn bộ thiết lập của máy Bambu trong
`Metadata/project_settings.config`. Chính phần cuối này làm Orca-Flashforge
không dùng được: sai profile máy, sai start/end G-code, sai bàn in, sai filament.

Converter giữ lại phần thuộc về *model*, thay phần thuộc về *máy*:

| Giữ nguyên | Thay bằng Creator 5 | Bỏ đi |
|---|---|---|
| `3D/3dmodel.model`, `3D/Objects/*` | profile máy (bed 256×256×256, klipper, start/end G-code) | tốc độ, gia tốc, retraction của Bambu |
| `Metadata/model_settings.config` (tên part, ma trận, vùng tô màu) | preset filament `@FF C5` | `Metadata/filament_settings_*.config` của Bambu |
| thiết lập in của người thiết kế (xem dưới) | `[Content_Types].xml`, `_rels/.rels`, `slice_info.config` | G-code đã slice sẵn, thư mục `Auxiliary/` |
| ảnh preview, `layer_heights_profile.txt` | | `Metadata/plate_*.json`, `cut_information.xml` |

145 thiết lập in được chuyển sang, những thứ mô tả ý đồ của người thiết kế chứ
không phải khả năng của máy: layer height, số lớp tường, infill, support (kể cả
tree support), brim, raft, seam, ironing, fuzzy skin, bù trừ lỗ/đường viền,
prime tower, gán filament theo vùng. Danh sách đầy đủ nằm trong `CARRY_OVER`
ở [js/converter.js](js/converter.js).

Mọi thứ liên quan đến phần cứng (`machine_*`, tốc độ, gia tốc, retraction,
nhiệt độ, làm mát) luôn lấy từ profile Creator 5, không bao giờ từ file gốc.

Vài thiết lập có cùng ý nghĩa nhưng khác cách viết giá trị giữa hai slicer.
Bambu ghi `ensure_vertical_shell_thickness: "enabled"`, còn Flash Studio chờ
`ensure_all`. Bê thẳng sang sẽ làm Flash Studio hiện hộp thoại *"Some values have
been replaced"* khi mở file. Bảng `ENUM_FIXUPS` trong
[js/converter.js](js/converter.js) dịch những giá trị này; giá trị nào không
nhận ra thì giữ mặc định Creator 5 chứ không đoán bừa.

### Giá trị ngoài khoảng cho phép

Bambu Studio ghi `-1` với nghĩa "tự động" ở một số thiết lập mà Flash Studio
chỉ nhận số không âm: `raft_first_layer_expansion` và `tree_support_wall_count`.
Chép thẳng sang thì Flash Studio từ chối mở: *"-1 not in range"*.

Không có cách nào biết khoảng hợp lệ của từng khoá, nên converter lấy chính
profile Creator 5 làm mốc: giá trị nguồn âm mà profile không bao giờ âm ở khoá
đó thì không chép. Quy tắc này dự đoán đúng cả hai khoá mà converter gốc cũng
bỏ, và không đụng tới những khoá mà profile thật sự dùng số âm
(`ironing_fan_speed` = -1, `skirt_start_angle` = -135, `standby_temperature_delta`
= -100). Bộ test quét toàn bộ file xuất ra để chắc không còn trường hợp nào.

### Hai thứ bắt buộc phải ghi lại

`version` và `<metadata name="Application">`. Bambu đánh số `02.06.00.51`.
Flash Studio so số đó với phiên bản của chính nó (ví dụ 2.4.0.2), thấy "mới hơn"
nên hiện hộp thoại *"The 3MF file version ... is newer than Flash Studio's
version"* rồi loại bỏ những khoá nó không nhận ra. File phải được đóng dấu bằng
phiên bản profile Flashforge (`TARGET_VERSION = '2.3.2'`), ở cả hai chỗ:
`project_settings.config` và dòng `Application` trong `3D/3dmodel.model`.

`different_settings_to_system`. Đây là danh sách Orca dùng để biết preset trong
project khác preset hệ thống ở những khoá nào. Để trống nghĩa là "y hệt preset
gốc", và Orca sẽ nạp đè preset hệ thống lên toàn bộ giá trị trong file, xoá sạch
mọi thiết lập chép từ file nguồn. Danh sách có một ô cho preset in, một ô cho mỗi
slot filament, một ô cho máy.

Chỉ khai báo những khoá khác với profile nhúng sẵn là không đủ. Bản thân profile
nhúng sẵn đã lệch preset hệ thống ở một số khoá: `initial_layer_print_height` là
0.2 trong khi preset gốc `0.20mm Standard @FF C5` là 0.25. Một khoá trùng giá trị
với profile nhưng lệch preset hệ thống mà không được khai báo sẽ bị Flash Studio
đặt lại về giá trị hệ thống. Vì vậy converter khai báo mọi khoá mà file nguồn có
nói đến, cộng với danh sách lệch sẵn có của chính profile. Với slot filament thì
chỉ khai báo đúng những khoá converter thực sự ghi vào.

### Filament và màu

Màu từng slot được giữ lại. Loại nhựa được map sang preset `@FF C5` tương ứng,
và nếu bật *Chỉnh nhiệt độ theo loại nhựa* thì nhiệt đầu phun và bàn nhiệt của
loại nhựa đó được ghi thẳng vào file, nên file vẫn mở đúng kể cả khi preset tên
đó chưa được cài trong Orca-Flashforge. Creator 5 có 4 slot; file dùng nhiều hơn
4 filament sẽ bị gộp phần dư vào slot cuối và trang web sẽ cảnh báo.

Khi bật tuỳ chọn đó, nhiệt độ lấy từ chính file gốc trước (cuộn nhựa cụ thể
người thiết kế dùng), chỉ khi file gốc không khai báo mới rơi về bảng chung.
Giới hạn tốc độ đùn và flow ratio thì luôn giữ của Creator 5, đó là thông số của
máy chứ không phải của cuộn nhựa.

### Bàn in và nhiều khay

Bambu P1S, X1 và A1 cũng là 256×256 nên vị trí giữ nguyên. Với A1 mini (180×180)
hay H2D (325×320), model được dời để giữ đúng vị trí tương đối trên bàn.

Project MakerWorld thường có nhiều khay in; file mẫu trong `samples/` có 13 khay.
Orca sắp các khay trên một lưới ảo nên vật thể ở toạ độ rất xa bàn là khay thứ 2
trở đi chứ không phải lỗi. Converter nhận ra điều này, không cảnh báo nhầm, và
không dời khi bàn in khác kích thước, vì mỗi khay có gốc toạ độ riêng nên dời
chung một khoảng sẽ chỉ đúng cho khay đầu.

## Mức độ đẹp

Bốn mức, xếp chồng lên nhau, áp dụng sau khi đã chép thiết lập của người thiết
kế. Chúng đánh đổi tốc độ ở tường ngoài, phần chiếm tỉ lệ nhỏ trong thời gian
đùn, và không đụng tới những thứ nhân thời gian in lên.

| Mức | Thêm gì |
|---|---|
| Giữ nguyên | không đổi gì |
| Nhẹ | `enable_arc_fitting`, `resolution` 0.012→0.008, `precise_outer_wall`, `precise_z_height`, hạ `top_surface_acceleration` |
| Cân bằng | hạ `outer_wall_speed` (theo lưu lượng, xem dưới), `outer_wall_acceleration` 5000→2500, `small_perimeter_speed`, các mức `overhang_*_speed`, `bridge_speed`, bật `reduce_crossing_wall` và `slowdown_for_curled_perimeters` |
| Tối đa | `outer_wall_speed` thấp hơn nữa, `outer_wall_acceleration` →1500, hạ `inner_wall_acceleration` và `default_acceleration`, `top_shell_layers` +1, `wall_loops` +1 |

`layer_height`, `initial_layer_print_height`, `sparse_infill_density` và ironing
không bao giờ bị đụng tới, có test chặn điều này.

### Tốc độ tường ngoài đổi theo file

Phần lớn các khoá trong bảng là hằng số suy ra từ profile máy. Riêng
`outer_wall_speed` còn bị chặn thêm bởi lưu lượng đùn:

```
speed = min( profile_speed × hệ_số ,  trần_lưu_lượng / (layer_height × line_width) )
```

Trần là 10 mm³/s cho Cân bằng, 7 mm³/s cho Tối đa. Cùng một con số mm/s cho ra
lưu lượng rất khác nhau tuỳ layer height, nên lưu lượng mới là đại lượng cần giữ
cố định chứ không phải tốc độ:

| layer height | Cân bằng | Tối đa |
|---|---|---|
| 0.12 mm | 120 mm/s (hệ số quyết định) | 80 mm/s |
| 0.20 mm | 119 mm/s | 80 mm/s |
| 0.24 mm | 99 mm/s | 69 mm/s |
| 0.28 mm | 85 mm/s | 60 mm/s |
| 0.32 mm | 74 mm/s | 52 mm/s |

Layer mỏng thì hệ số tốc độ quyết định, không chậm thừa. Layer dày thì trần lưu
lượng quyết định, giữ máy cách xa giới hạn 18 mm³/s của PLA. Thẻ kết quả ghi rõ
con số nào đang quyết định, và liệt kê mọi giá trị bị đổi.

![Thẻ kết quả: đổi máy, các slot filament, số khay và từng thiết lập được chỉnh](screenshots/3-result.png)

`line_width` chấp nhận cả dạng mm lẫn phần trăm đường kính nozzle. Giá trị tốc độ
viết dạng phần trăm (`50%`, tức là tương đối so với tốc độ khác) được bỏ qua
nguyên vẹn vì nó tự bám theo rồi.

### Hai quy tắc trong `applyQuality()`

Giá trị đích tính từ profile máy rồi lấy `min` với giá trị hiện tại, nên một file
mà người thiết kế đã chỉnh mịn hơn sẽ không bị kéo ngược lại. Mỗi khoá đều có sàn
và trần, nên một profile vốn đã chậm không bị hạ xuống mức vô lý; sàn thắng cả
trần lưu lượng.

Bảng mức chỉ dùng khoá số và boolean, và chỉ những khoá có trong profile Creator
5. Các thiết lập kiểu enum (`ironing_type`, `wall_generator`, `seam_slope_type`)
bị loại ra vì không kiểm chứng được cách viết giá trị mà Flash Studio chấp nhận,
đoán sai là file lại hiện hộp thoại "some values have been replaced". Ironing
muốn dùng thì bật tay trong Orca-Flashforge.

Thẻ kết quả ghi từng thay đổi dạng `outer_wall_speed 200 → 120`. Không có phần
trăm thời gian ước lượng, vì không slice thì không biết được. Orca sẽ cho con số
thật.

## Ba mức chuyển đổi

Đầy đủ làm tất cả những gì mô tả ở trên. Chỉ đổi profile máy thì dùng thiết lập
in mặc định của Creator 5 và bỏ qua thiết lập trong file gốc. Chỉ lấy hình học
thì xuất 3MF thuần hình học không kèm thiết lập nào, bạn tự setup trong slicer.

## Profile riêng

Profile Creator 5 nhúng sẵn được trích từ một project Orca-Flashforge thật
(`Flashforge Creator 5 0.4 nozzle`, 679 khoá thiết lập). Nếu bạn dùng nozzle khác
0.4 hoặc đã tinh chỉnh máy, kéo một file `.3mf` đã lưu từ Orca-Flashforge của bạn
vào mục *Profile riêng của bạn*, converter sẽ dùng đúng profile đó.

Muốn thay hẳn profile nhúng sẵn:

```bash
npm run extract-profile -- "My Print_CREATOR5.3mf"
```

## Test

```bash
npm run fixtures     # dựng file MakerWorld giả lập từ file mẫu Creator 5
npm test             # 126 test logic + 14 test static + 47 test đối chiếu file thật
node test/e2e.mjs    # 33 test trên Chrome thật
```

`test/e2e.mjs` cần `npm start` đang chạy và Google Chrome đã cài.

`test/samples.cjs` chuyển hai file MakerWorld thật trong `samples/` (MoonLamp, một
project Bambu P1S có 13 khay và 290 MB mesh; iris_lamp, một project Bambu A1 có 2
khay) rồi so với file `_CREATOR5.3mf` do công cụ gốc tạo ra: cùng máy, cùng bàn
in, cùng preset filament, cùng màu, cùng layer height, infill, shell và support,
với 290 MB mesh đi qua nguyên vẹn từng byte. Một bộ test khác so file xuất ra với
một project Creator 5 thật: cùng bộ khoá thiết lập, mọi khoá cấp máy khớp từng
giá trị, và `[Content_Types].xml` giống từng byte.

File 48 MB mất khoảng 7 giây để giải nén, đổi thiết lập và nén lại ở mức 4.

## Cấu trúc

```
index.html
css/style.css
js/
  app.js               giao diện, kéo thả, hiển thị kết quả
  converter.js         toàn bộ logic chuyển đổi (chạy được cả trong Node)
  i18n.js              chuỗi VI/EN
  profiles/creator5.js profile Creator 5 (sinh tự động)
  vendor/fflate.min.js zip/unzip
tools/extract-profile.mjs
test/
```

## Giới hạn

Công cụ đổi *thiết lập*, không sửa *hình học*. Model thiết kế riêng cho AMS, cho
bàn in lớn hơn 256×256, hoặc dùng tính năng chỉ Bambu mới có, vẫn cần bạn chỉnh
tay trong Orca-Flashforge. Luôn kiểm tra preview trước khi in.
