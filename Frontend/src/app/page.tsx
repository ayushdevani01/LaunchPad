import { MarketingNav } from "@/components/site/marketing-nav";
import { ScrollProgress } from "@/components/site/scroll-progress";
import { SiteFooter } from "@/components/site/site-footer";
import { Hero } from "@/components/landing/hero";
import { FrameworkStack } from "@/components/landing/framework-stack";
import { Workflow } from "@/components/landing/workflow";
import { Platform } from "@/components/landing/platform";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { Cta } from "@/components/landing/cta";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to content
      </a>
      <MarketingNav />
      <ScrollProgress />
      <main id="main">
        <Hero />
        <FrameworkStack />
        <Workflow />
        <Platform />
        <Pricing />
        <Faq />
        <Cta />
      </main>
      <SiteFooter />
    </div>
  );
}
