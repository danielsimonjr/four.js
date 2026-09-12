import { createGzipLoader } from "@fourjs/assets";

declare global {
  interface Window {
    fourGzipProbe?: (
      bytes: number[],
      maximumDecodedBytes: number,
    ) => Promise<string>;
  }
}
window.fourGzipProbe = async (bytes, maximumDecodedBytes) => {
  const loader = createGzipLoader(
    (encoded) =>
      new Blob([encoded])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"))
        .getReader(),
    { maximumDecodedBytes },
  );
  try {
    const decoded = await loader.load(
      new Response(Uint8Array.from(bytes)),
      "/fixture.gz",
    );
    return new TextDecoder().decode(decoded);
  } catch (error) {
    return (error as { code: string }).code;
  }
};
document.body.dataset.gzipReady = "1";
