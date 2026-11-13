import { FamilyFooter } from "@/components/family-footer";
import { Drawer } from "@/components/drawer";
import { MethodDrawer } from "@/components/method-drawer";
import { formatDate } from "@/format-date";
import { snapshot } from "@/data/snapshot";

/*
  The product footer: the family three-zone layout. The credits zone carries
  the energy-charts attribution (verbatim license lines from the API docs,
  see docs/data-notes.md), the colophon seats the method drawer in the extra
  slot and the disclaimer drawer prop per the family pattern.
*/
export function SiteFooter() {
  const s = snapshot.sources;
  return (
    <FamilyFooter
      credits={
        <>
          <p>
            <a href={s.energyCharts.url} className="underline underline-offset-4 hover:text-foreground">
              energy-charts.info (Fraunhofer ISE)
            </a>
            ,{" "}
            <a href={s.energyCharts.licenseUrl} className="underline underline-offset-4 hover:text-foreground">
              CC BY 4.0
            </a>
            ; day-ahead prices{" "}
            <a href="https://www.smard.de" className="underline underline-offset-4 hover:text-foreground">
              Bundesnetzagentur | SMARD.de
            </a>{" "}
            (CC BY 4.0). Retrieved {formatDate(s.retrievedAt)}.
          </p>
          <p className="mt-1">
            <a href={s.openMeteo.url} className="underline underline-offset-4 hover:text-foreground">
              Open-Meteo
            </a>{" "}
            weather overlay,{" "}
            <a href={s.openMeteo.licenseUrl} className="underline underline-offset-4 hover:text-foreground">
              CC BY 4.0
            </a>
            . Retrieved {formatDate(s.retrievedAt)}.
          </p>
          <p className="mt-1">
            Data: energy-charts.info (Fraunhofer ISE), CC BY 4.0 — day-ahead prices CC BY 4.0 from
            Bundesnetzagentur | SMARD.de. Full method, licenses and rules in the method drawer.
          </p>
        </>
      }
      disclaimer={
        <Drawer
          label="Disclaimer"
          title="Disclaimer"
          description="What this atlas is and is not."
        >
          <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              The Green Grid Atlas is an open-data story about the Dutch electricity grid, built from
              energy-charts.info (Fraunhofer ISE, CC BY 4.0; day-ahead prices from Bundesnetzagentur | SMARD.de,
              CC BY 4.0) and Open-Meteo weather (CC BY 4.0). It refreshes daily from a committed snapshot; it is
              snapshot-fresh, never live.
            </p>
            <p>
              Computed carbon intensity uses the generation mix and does not attribute imports. The risk
              indicators are derived indicators, not a grid-security assessment. Nothing here is investment,
              switching, or grid-operations advice.
            </p>
          </div>
        </Drawer>
      }
      extra={<MethodDrawer />}
    />
  );
}
