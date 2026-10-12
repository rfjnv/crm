import ManagerKpiPanel from '../components/ManagerKpiPanel';

/**
 * KPI менеджеров отдельной страницей — для HR, у которого нет сводной «Аналитики»
 * (там выручка компании). Та же панель, что и в «Аналитике» у админов.
 */
export default function KpiPage() {
  return <ManagerKpiPanel />;
}
