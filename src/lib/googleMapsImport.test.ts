import { describe, expect, it } from "vitest";
import { GoogleMapsImportError, parseGoogleMapsImportFile } from "./googleMapsImport";

describe("parseGoogleMapsImportFile - CSV", () => {
  it("ヘッダー付きCSVからTitle/URLの列を認識し、!3d!4d形式の座標を取り出す", () => {
    const csv =
      "Title,Note,URL\n" +
      '"焼き鳥 いろは",,"https://maps.google.com/?q=place&data=!3d35.681236!4d139.767125"\n';

    const { places, truncated } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(truncated).toBe(0);
    expect(places).toEqual([
      { name: "焼き鳥 いろは", location: { lat: 35.681236, lng: 139.767125 } },
    ]);
  });

  it("!3d!4dが無い場合は@lat,lng形式にフォールバックする", () => {
    const csv = "Title,Note,URL\n" + 'Bar A,,"https://maps.google.com/@35.0,139.0,17z"\n';

    const { places } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toEqual([{ name: "Bar A", location: { lat: 35.0, lng: 139.0 } }]);
  });

  it("URLに座標が無い場合はlocation: nullとして取り込む(後付け設定可能)", () => {
    const csv = "Title,Note,URL\nBar B,,https://maps.google.com/?q=Bar+B\n";

    const { places } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toEqual([{ name: "Bar B", location: null }]);
  });

  it("Titleヘッダーが無い場合は先頭列を名前、末尾列をURLとして扱う", () => {
    const csv = '居酒屋C,"https://maps.google.com/@34.5,135.5,16z"\n';

    const { places } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toEqual([{ name: "居酒屋C", location: { lat: 34.5, lng: 135.5 } }]);
  });

  it("ダブルクォート内のカンマ・改行・エスケープされた\"\"を1フィールドとして扱う", () => {
    const csv =
      "Title,Note,URL\n" +
      '"店名, 支店A","メモ\n複数行","https://maps.google.com/@1.0,2.0,15z"\n' +
      '"クォート""付き""の店",,\n';

    const { places } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toEqual([
      { name: "店名, 支店A", location: { lat: 1.0, lng: 2.0 } },
      { name: 'クォート"付き"の店', location: null },
    ]);
  });

  it("空白のみの行や名前が空の行は除外する", () => {
    const csv = "Title,Note,URL\n,,\n   ,,\n本命の店,,\n";

    const { places } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toEqual([{ name: "本命の店", location: null }]);
  });

  it("ヘッダーのみ(データ行なし)の場合はエラーを投げる", () => {
    expect(() => parseGoogleMapsImportFile("saved.csv", "Title,Note,URL\n")).toThrow(
      GoogleMapsImportError
    );
  });

  it("空文字の場合はエラーを投げる", () => {
    expect(() => parseGoogleMapsImportFile("saved.csv", "")).toThrow(GoogleMapsImportError);
  });

  it("500件を超える場合は500件に切り詰め、truncated件数を返す", () => {
    const header = "Title,Note,URL\n";
    const rows = Array.from({ length: 510 }, (_, i) => `店${i},,`).join("\n");
    const csv = header + rows;

    const { places, truncated } = parseGoogleMapsImportFile("saved.csv", csv);

    expect(places).toHaveLength(500);
    expect(truncated).toBe(10);
  });

  it(".tsv拡張子もCSVと同じパーサーで処理する", () => {
    const csv = "Title,Note,URL\n居酒屋D,,\n";

    const { places } = parseGoogleMapsImportFile("saved.tsv", csv);

    expect(places).toEqual([{ name: "居酒屋D", location: null }]);
  });
});

describe("parseGoogleMapsImportFile - KML", () => {
  it("Placemarkの名前と座標(lng,lat[,alt])を取り出す", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml><Document>
  <Placemark>
    <name>公園X</name>
    <Point><coordinates>139.767125,35.681236,0</coordinates></Point>
  </Placemark>
</Document></kml>`;

    const { places } = parseGoogleMapsImportFile("mymap.kml", kml);

    expect(places).toEqual([{ name: "公園X", location: { lat: 35.681236, lng: 139.767125 } }]);
  });

  it("座標が欠損しているPlacemarkはlocation: nullで取り込む", () => {
    const kml = `<kml><Document>
  <Placemark><name>座標なしスポット</name></Placemark>
</Document></kml>`;

    const { places } = parseGoogleMapsImportFile("mymap.kml", kml);

    expect(places).toEqual([{ name: "座標なしスポット", location: null }]);
  });

  it("座標が数値として解釈できない場合はlocation: nullにする", () => {
    const kml = `<kml><Document>
  <Placemark>
    <name>壊れた座標</name>
    <Point><coordinates>not-a-number,also-bad</coordinates></Point>
  </Placemark>
</Document></kml>`;

    const { places } = parseGoogleMapsImportFile("mymap.kml", kml);

    expect(places).toEqual([{ name: "壊れた座標", location: null }]);
  });

  it("名前が空のPlacemarkは除外する", () => {
    const kml = `<kml><Document>
  <Placemark><Point><coordinates>1.0,2.0</coordinates></Point></Placemark>
  <Placemark><name>有効な場所</name></Placemark>
</Document></kml>`;

    const { places } = parseGoogleMapsImportFile("mymap.kml", kml);

    expect(places).toEqual([{ name: "有効な場所", location: null }]);
  });

  it("Placemarkが1つも読み取れない場合はエラーを投げる", () => {
    const kml = `<kml><Document></Document></kml>`;

    expect(() => parseGoogleMapsImportFile("mymap.kml", kml)).toThrow(GoogleMapsImportError);
  });
});

describe("parseGoogleMapsImportFile - 未対応形式", () => {
  it("拡張子がcsv/tsv/kml以外の場合はエラーを投げる", () => {
    expect(() => parseGoogleMapsImportFile("places.json", "{}")).toThrow(GoogleMapsImportError);
  });
});
