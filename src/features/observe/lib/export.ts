export function downloadView(svg: SVGSVGElement) {
  // 直接序列化当前 DOM 中的 SVG：其中的可见分片与折痕裁剪结果即屏幕所见，
  // 遮挡关系、透视模式与配色都会被忠实保存。
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", "1200");
  copy.setAttribute("height", "840");
  copy.removeAttribute("class");
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "ORI-observe.svg";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
