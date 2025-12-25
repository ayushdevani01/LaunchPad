"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

export const Preloader = () => {
    const [isComplete, setIsComplete] = useState(false);
    const loaderWrapRef = useRef<HTMLDivElement>(null);
    const svgPathRef = useRef<SVGPathElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);

    useLayoutEffect(() => {
        document.body.style.overflow = "hidden";

        const svg = svgPathRef.current;
        const loaderWrap = loaderWrapRef.current;
        const heading = headingRef.current;

        if (!svg || !loaderWrap || !heading) return;

        const curve = "M0 502S175 272 500 272s500 230 500 230V0H0Z";
        const flat = "M0 2S175 1 500 1s500 1 500 1V0H0Z";

        gsap.set(heading, { y: 200, skewY: 10, visibility: "visible" });

        const tl = gsap.timeline({
            onComplete: () => {
                document.body.style.overflow = "visible";
                setIsComplete(true);
            },
        });

        tl.to(heading, {
            delay: 0.3,
            y: 0,
            skewY: 0,
            duration: 0.8,
            ease: "power2.out",
        });

        tl.to(heading, {
            delay: 0.5,
            y: -200,
            skewY: -10,
            duration: 0.8,
            ease: "power2.in",
        });

        tl.to(svg, {
            duration: 0.8,
            attr: { d: curve },
            ease: "power2.in",
        });

        tl.to(svg, {
            duration: 0.8,
            attr: { d: flat },
            ease: "power2.out",
        });

        tl.to(loaderWrap, {
            y: -1500,
            duration: 0.8,
        });

        tl.to(loaderWrap, {
            zIndex: -1,
            display: "none",
            duration: 0,
        });

        return () => {
            tl.kill();
        };
    }, []);

    if (isComplete) {
        return null;
    }

    return (
        <div ref={loaderWrapRef} className="loader-wrap">
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="loaderGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#0a0014" />
                        <stop offset="50%" stopColor="#2d1b4e" />
                        <stop offset="100%" stopColor="#815ac2" />
                    </linearGradient>
                </defs>
                <path
                    ref={svgPathRef}
                    fill="url(#loaderGradient)"
                    d="M0,1005S175,995,500,995s500,5,500,5V0H0Z"
                />
            </svg>

            <div className="loader-wrap-heading">
                <span>
                    <h1 ref={headingRef} style={{ visibility: 'hidden' }}>Launch Pad</h1>
                </span>
            </div>
        </div>
    );
};
