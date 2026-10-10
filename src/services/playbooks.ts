/**
 * Prototype incident-response playbooks, keyed by staff-reported severity.
 *
 * ILLUSTRATIVE ONLY. These example actions and targets are not official GMRC procedures and do not replace
 * approved emergency protocols. Operational owners must define and approve real procedures before any use.
 *
 * Definitions are plain data so they can be configured or replaced without touching UI code.
 */
import type { Severity } from '../types'

export interface PlaybookAction {
  /** Stable ID. Stored in event logs and backups, so never reuse or renumber one. */
  id: string
  title: string
  description: string
  severity: Severity
  /** Minutes after the report was created by which the action should be done. Omit for no target. */
  responseTargetMinutes?: number
}

export interface PlaybookConfig {
  actions: PlaybookAction[]
}

export const defaultPlaybookConfig: PlaybookConfig = {
  actions: [
    { id: 'PB_LOW_REASSESS', severity: 'LOW', title: 'Reassess the crowd condition', description: 'Look at the reported area again and confirm whether the condition has changed.', responseTargetMinutes: 60 },
    { id: 'PB_LOW_RECORD', severity: 'LOW', title: 'Record observations', description: 'Add what you observed to the incident notes.' },

    { id: 'PB_MEDIUM_RECHECK', severity: 'MEDIUM', title: 'Recheck the affected zone', description: 'Recheck the reported station zone.', responseTargetMinutes: 30 },
    { id: 'PB_MEDIUM_NOTIFY', severity: 'MEDIUM', title: 'Notify the designated supervisor', description: 'Notify the designated supervisor according to local procedures.', responseTargetMinutes: 30 },
    { id: 'PB_MEDIUM_UPDATE', severity: 'MEDIUM', title: 'Update the incident notes', description: 'Update the incident notes with the latest observation.', responseTargetMinutes: 60 },

    { id: 'PB_HIGH_REVIEW', severity: 'HIGH', title: 'Review the situation promptly', description: 'Review the situation at the location without delay.', responseTargetMinutes: 15 },
    { id: 'PB_HIGH_NOTIFY', severity: 'HIGH', title: 'Notify the responsible supervisor', description: 'Recommended: notify the responsible supervisor.', responseTargetMinutes: 15 },
    { id: 'PB_HIGH_RECORD', severity: 'HIGH', title: 'Record the response and reassess', description: 'Record the response taken, then reassess the incident.', responseTargetMinutes: 30 },

    { id: 'PB_CRITICAL_PROCEDURES', severity: 'CRITICAL', title: 'Follow approved emergency procedures', description: "Follow your organization's approved emergency procedures.", responseTargetMinutes: 5 },
    { id: 'PB_CRITICAL_CONTACT', severity: 'CRITICAL', title: 'Contact the control room or supervisor', description: 'Contact the designated control room or supervisor according to local policy.', responseTargetMinutes: 5 },
    { id: 'PB_CRITICAL_RECORD', severity: 'CRITICAL', title: 'Record actions and observations', description: 'Record the actions taken and the observed situation.', responseTargetMinutes: 15 },
  ],
}

export const PLAYBOOK_DISCLAIMER =
  'Illustrative prototype actions only. They are not official GMRC procedures and do not replace approved emergency protocols.'

/** Actions that apply to a severity, in definition order. Unknown severities yield an empty list. */
export function getPlaybook(severity: unknown, config: PlaybookConfig = defaultPlaybookConfig): PlaybookAction[] {
  return config.actions.filter((action) => action.severity === severity)
}

export function findAction(actionId: string, config: PlaybookConfig = defaultPlaybookConfig): PlaybookAction | undefined {
  return config.actions.find((action) => action.id === actionId)
}
