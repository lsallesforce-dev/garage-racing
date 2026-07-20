// Config do Remotion (usada só pelo CLI/render — não afeta o build do Next).
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setEntryPoint("./remotion/index.ts");
Config.setPublicDir("./public");
