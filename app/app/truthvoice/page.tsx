'use client'

// /truthvoice: demo mode (S11, mock gateway) unless tidecloak.json names a realm, then Tide mode (S12).
import { TIDE_MODE } from '../lib/tideConfig'
import DemoTruthVoice from './DemoTruthVoice'
import TideTruthVoice from './TideTruthVoice'

export default function TruthVoicePage() {
  return TIDE_MODE ? <TideTruthVoice /> : <DemoTruthVoice />
}
