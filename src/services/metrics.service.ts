import type { Lead } from '../models/lead.js';

export interface Metrics {
  total_leads: number;
  qualified: number;
  rejected: number;
  pending_qualification: number;
  messages_sent: number;
  messages_failed: number;
  messages_pending: number;
  sla_pass: number;
  sla_fail: number;
  average_delivery_seconds: number;
}

function elapsedSeconds(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
}

export function computeMetrics(leads: Lead[], slaSeconds: number): Metrics {
  const nowIso = new Date().toISOString();

  const qualified = leads.filter((l) => l.qualificado_em !== null);
  const rejected = leads.filter(
    (l) => l.status === 'new' && l.qualification_checked_em !== null && l.qualificado_em === null,
  );
  const pendingQualification = leads.filter((l) => l.status === 'new' && l.qualification_checked_em === null);

  const sent = leads.filter((l) => l.whatsapp_status === 'enviado' && l.enviado_em !== null);
  const failed = leads.filter((l) => l.status === 'erro');
  const pendingMessages = leads.filter((l) => l.whatsapp_status === 'pending' || l.whatsapp_status === 'retrying');

  let slaPass = 0;
  let slaFail = 0;
  let totalDeliverySeconds = 0;

  for (const lead of sent) {
    const elapsed = elapsedSeconds(lead.qualificado_em!, lead.enviado_em!);
    totalDeliverySeconds += elapsed;
    if (elapsed < slaSeconds) slaPass += 1;
    else slaFail += 1;
  }

  // Qualificados ainda não enviados que já estouraram o SLA também contam como falha de SLA.
  for (const lead of qualified) {
    if (lead.whatsapp_status === 'enviado') continue;
    const elapsed = elapsedSeconds(lead.qualificado_em!, nowIso);
    if (elapsed >= slaSeconds) slaFail += 1;
  }

  return {
    total_leads: leads.length,
    qualified: qualified.length,
    rejected: rejected.length,
    pending_qualification: pendingQualification.length,
    messages_sent: sent.length,
    messages_failed: failed.length,
    messages_pending: pendingMessages.length,
    sla_pass: slaPass,
    sla_fail: slaFail,
    average_delivery_seconds: sent.length > 0 ? Number((totalDeliverySeconds / sent.length).toFixed(2)) : 0,
  };
}
