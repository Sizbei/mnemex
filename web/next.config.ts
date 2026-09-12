import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The API route imports the real mnemex tools from the parent package so the
  // UI shows the running system, not a reimplementation of it.
  outputFileTracingRoot: "..",
  serverExternalPackages: ["fastembed", "neo4j-driver", "@daytonaio/sdk", "onnxruntime-node"],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
