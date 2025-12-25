import gcpLogo from "../assets/Marquee images/GCP-remove.png";
import mongoLogo from "../assets/Marquee images/Mongo.png";
import cloudRunLogo from "../assets/Marquee images/cloud_run.png";
import dockerLogo from "../assets/Marquee images/docker-removebg-preview.png";
import nextLogo from "../assets/Marquee images/next.png";
import redisLogo from "../assets/Marquee images/redis.png";
import cloud from "../assets/Marquee images/cloudflare.png";
import LogoCarousel from "./companylogos";

const images = [
  { src: gcpLogo, alt: "Google Cloud Platform" },
  { src: mongoLogo, alt: "MongoDB" },
  { src: cloudRunLogo, alt: "Cloud Run" },
  { src: dockerLogo, alt: "Docker" },
  { src: nextLogo, alt: "Next.js" },
  { src: redisLogo, alt: "Redis" },
  { src: cloud, alt: "Cloudflare" },
];

export const LogoTicker = () => {
  return (
    <div className="bg-black text-white py-[72px] sm:py-24">
      <div className="container">
        <h2 className="text-3xl text-center text-white/70 mb-16">Built with modern technologies</h2>
        <LogoCarousel />
      </div>
    </div>
  )
};
