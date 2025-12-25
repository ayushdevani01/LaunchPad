import Image from 'next/image'
import gcpLogo from "../assets/Marquee images/GCP-remove.png";
import mongoLogo from "../assets/Marquee images/Mongo.png";
import cloudRunLogo from "../assets/Marquee images/cloud_run.png";
import dockerLogo from "../assets/Marquee images/docker-removebg-preview.png";
import nextLogo from "../assets/Marquee images/next.png";
import redisLogo from "../assets/Marquee images/redis.png";
import cloudflareLogo from "../assets/Marquee images/cloudflare.png";

export default function LogoCarousel() {

  const logos = [
    { src: gcpLogo, alt: "Google Cloud Platform", size: 150 },
    { src: mongoLogo, alt: "MongoDB", size: 150 },
    { src: cloudRunLogo, alt: "Cloud Run", size: 150 },
    { src: dockerLogo, alt: "Docker", size: 150 },
    { src: nextLogo, alt: "Next.js", size: 50 },
    { src: redisLogo, alt: "Redis", size: 150 },
    { src: cloudflareLogo, alt: "Cloudflare", size: 150 },
  ]

  return (
    <div className="w-full inline-flex flex-nowrap overflow-hidden [mask-image:_linear-gradient(to_right,transparent_0,_black_128px,_black_calc(100%-128px),transparent_100%)]">
      <ul className="flex items-center justify-center md:justify-start [&_li]:mx-8 [&_img]:max-w-none animate-infinite-scroll">
        {logos.map((logo, index) => (
          <li key={index}>
            <Image src={logo.src} alt={logo.alt} width={logo.size} height={logo.size} className="object-contain" />
          </li>
        ))}
      </ul>
      <ul className="flex items-center justify-center md:justify-start [&_li]:mx-8 [&_img]:max-w-none animate-infinite-scroll" aria-hidden="true">
        {logos.map((logo, index) => (
          <li key={index}>
            <Image src={logo.src} alt={logo.alt} width={logo.size} height={logo.size} className="object-contain" />
          </li>
        ))}
      </ul>
    </div>
  )
}