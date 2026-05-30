import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'

const nextConfig: NextConfig = {
  // Next.js config options go here
}

// Wrap the Next.js config with Payload so the admin panel + API mount correctly.
export default withPayload(nextConfig)
