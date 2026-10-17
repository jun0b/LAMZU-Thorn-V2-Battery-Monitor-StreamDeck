import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.jun0b.thornv2-battery-monitor.sdPlugin";

/**
 * Stream Deck プラグイン向け Rollup 設定
 * TypeScript をコンパイルし、プラグイン配布ディレクトリの bin/plugin.js を生成する
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "esm",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			// manifest.json の変更を監視対象に追加
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			}
		},
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			// Node.js ESM プラグインとして認識させるため bin/package.json を出力
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({
					fileName: "package.json",
					source: `{ "type": "module" }`,
					type: "asset"
				});
			}
		}
	]
};

export default config;
