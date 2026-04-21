import { Areas } from '@/components/Areas';
import { AskSection } from '@/components/AskSection';
import { ClosingCta } from '@/components/ClosingCta';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Nav } from '@/components/Nav';
import { Pricing } from '@/components/Pricing';
import { Privacy } from '@/components/Privacy';
import { Quote } from '@/components/Quote';
import { Suggestion } from '@/components/Suggestion';
import { Testimonials } from '@/components/Testimonials';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Quote />
        <Areas />
        <HowItWorks />
        <AskSection />
        <Suggestion />
        <Testimonials />
        <Privacy />
        <Pricing />
        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}
