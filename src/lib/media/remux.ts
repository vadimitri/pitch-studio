// Rewrites a MediaRecorder file into a clean container without re-encoding (packets are copied):
// correct duration in the header (WebKit sometimes writes 0xFFFFFFFF = "7158285 s"; Chrome's WebM has none)
// and fast start (moov first), so downloads play everywhere, including QuickTime and phones.
export async function remux(blob: Blob): Promise<Blob> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const webm = blob.type.includes("webm");
  const target = new mb.BufferTarget();
  const output = new mb.Output({
    format: webm ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const conversion = await mb.Conversion.init({ input, output, showWarnings: false });
  if (!conversion.isValid) throw new Error(`remux: ${conversion.discardedTracks.map((d) => d.reason).join(", ")}`);
  await conversion.execute();
  if (!target.buffer) throw new Error("remux: empty output");
  return new Blob([target.buffer], { type: webm ? "video/webm" : "video/mp4" });
}
