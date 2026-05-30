// Manual browser publisher for platforms without a stable official publish API.
//
// It does not touch third-party accounts. Instead it validates the channel
// content and stores a deterministic handoff package in publishResult so an
// operator (or future Playwright worker) can complete the final platform step.

import { isManualPlatform, type ManualPlatformCode } from '../platforms/registry'
import { buildSocialPackage } from '../renderers/social-package'
import type { Publisher, PublishInput, PublishResult } from './types'

export class ManualPublisher implements Publisher {
  readonly platform: ManualPlatformCode

  constructor(platform: ManualPlatformCode) {
    this.platform = platform
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const actualPlatform = input.channelContent?.platform
    if (!isManualPlatform(actualPlatform) || actualPlatform !== this.platform) {
      throw new Error(`人工发布器平台不匹配：期望 ${this.platform}，实际 ${String(actualPlatform)}`)
    }

    const manualPackage = buildSocialPackage(input.channelContent)
    const errors = manualPackage.warnings.filter((warning) => warning.level === 'error')
    if (errors.length > 0) {
      throw new Error(errors.map((warning) => warning.message).join('；'))
    }

    return {
      stage: 'manual_ready',
      statusAfterPublish: 'ready_to_publish',
      manualPackage,
    }
  }
}
