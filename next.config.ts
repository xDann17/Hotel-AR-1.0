import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

esLint: {
  ignoreDuringBuilds: true,
},
typescript: {
  ignoreBuildErrors: true,
},
};


export default nextConfig;
