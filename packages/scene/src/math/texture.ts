// texture.ts — a tall matrix of bytes as ONE texture, PURE: the layout, the packing,
// and the same texel arithmetic in GLSL for the shader that reads it.
//
// A matrix of `rows × cols` (a mesh of 2 s rows × 128 bands; any time series of
// fixed-width rows) fits a texture only while `rows ≤ MAX_TEXTURE_SIZE` — 2048 is all
// WebGL2 guarantees, ~68 minutes of 2 s rows. Past that it WRAPS into side-by-side
// columns of `cols` texels, each holding `rowsPerColumn` rows.
//
// ⚠️ **THE SHADER AND THE TYPESCRIPT MUST DO THE SAME ARITHMETIC.** An off-by-one in
// either draws a plausible picture of the wrong rows. So the GLSL is not written
// twice: a shader interpolates `MATRIX_TEXEL_GLSL` and calls `matrixTexel`, which is
// `texelOf` below — and test/scene.test.mjs reads the snippet for those expressions.

export interface TextureLayout {
  width: number;
  height: number;
  columns: number;
  rowsPerColumn: number;
  cols: number;
  rows: number;
}

/** Where a `rows × cols` matrix goes in a texture no side of which exceeds `maxSize`. */
export function textureLayout(rows: number, cols: number, maxSize = 2048): TextureLayout {
  if (!(rows > 0) || !(cols > 0)) throw new Error(`scene: empty matrix ${rows}x${cols}`);
  const columns = Math.ceil(rows / maxSize);
  const width = cols * columns;
  if (width > maxSize) throw new Error(`scene: ${rows} rows cannot fit a ${maxSize} texture`);
  const rowsPerColumn = Math.ceil(rows / columns);
  return { width, height: rowsPerColumn, columns, rowsPerColumn, cols, rows };
}

/** The texel holding (row, col). `matrixTexel` in MATRIX_TEXEL_GLSL is this. */
export function texelOf(row: number, col: number, layout: TextureLayout): [number, number] {
  const column = Math.floor(row / layout.rowsPerColumn);
  return [col + column * layout.cols, row - column * layout.rowsPerColumn];
}

/** Row-major matrix bytes → the texture's own row-major memory. Unused texels are 0.
 *  Throws on a length that does not match the declared shape. */
export function packTexture(bytes: Uint8Array, layout: TextureLayout): Uint8Array {
  const { rows, cols, width } = layout;
  if (bytes.length !== rows * cols) {
    throw new Error(`scene: ${bytes.length} bytes for a declared ${rows}x${cols}`);
  }
  const out = new Uint8Array(layout.width * layout.height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, y] = texelOf(r, c, layout);
      out[y * width + x] = bytes[r * cols + c];
    }
  }
  return out;
}

/** `texelOf`, in GLSL ES 3.00. Integer division truncates, which for the
 *  non-negative rows a shader asks about is `Math.floor`. */
export const MATRIX_TEXEL_GLSL = `ivec2 matrixTexel(int row, int col, int cols, int rowsPerColumn) {
  int column = row / rowsPerColumn;
  return ivec2(col + column * cols, row - column * rowsPerColumn);
}`;
