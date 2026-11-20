import { cn } from "cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

/**
 * The family section heading pattern: the display heading of a data
 * section: primary token in light, white in dark, with the heavy
 * weight and tight tracking the family pages use. className is only
 * for documented scale overrides (e.g. gg-heading-wide), never for
 * ad-hoc size, weight, leading or tracking.
 */
export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("gg-heading", className)}>
      {children}
    </h2>
  );
}

/**
 * The family card container pattern: every visual sits in a Card on a
 * page section, mb-12 between sections, with the section heading and
 * its description in the card header. contentClassName lets a
 * section shape the body (a flex column, for instance) without
 * reopening the container markup. The children are the visual itself;
 * every figure rendered around it is computed from the product's data
 * at render time, never a hardcoded literal.
 */
export function FamilySection({
  title,
  description,
  contentClassName,
  headingClassName,
  children,
}: {
  /** Section title, rendered with the SectionHeading pattern. */
  title: React.ReactNode;
  /** Optional lead paragraph under the heading. */
  description?: React.ReactNode;
  /** Optional additional classes on the card body. */
  contentClassName?: string;
  /** Optional documented scale override for the heading (e.g. gg-heading-wide). */
  headingClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <Card>
        <CardHeader>
          <SectionHeading className={headingClassName}>{title}</SectionHeading>
          {description && <CardDescription className="gg-lede mt-1">{description}</CardDescription>}
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
      </Card>
    </section>
  );
}
