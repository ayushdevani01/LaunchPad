'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'

interface PricingTabProps {
  yearly: boolean
  popular?: boolean
  planName: string
  price: {
    monthly: number
    yearly: number
  }
  planDescription: string
  features: string[]
}

export function PricingTab(props: PricingTabProps) {
  return (
    <div className={`h-full `}>
      <div className="relative flex flex-col h-full p-6 rounded-2xl bg-black border border-white/30 shadow shadow-black/80">
        {props.popular && (
          <div className="absolute top-0 right-0 mr-6 -mt-4">
          </div>
        )}
        <div className="mb-5">
          <div className="text-white/70 font-semibold mb-1">{props.planName}</div>
          <div className="inline-flex items-baseline mb-2">
            <span className="text-white/70 font-bold text-3xl">$</span>
            <span className="text-white/50 font-bold text-4xl">{props.yearly ? props.price.yearly : props.price.monthly}</span>
            <span className="text-white/70 font-medium">/mo</span>
          </div>
          <div className="text-sm text-white/70 mb-5">{props.planDescription}</div>
        </div>
        <motion.button
          whileTap={{ scale: 0.98 }}
          disabled={true}
          className={`mt-8 w-full py-4 px-8 rounded-full font-semibold text-lg transition-all duration-300 shadow-lg ${props.popular
            ? "bg-gradient-to-r from-[#9560EB] to-[#7c3aed] text-white hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            : "bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
        >
          {props.planName === "Pro" || props.planName === "Enterprise" ? "Coming Soon" : "Owned"}
        </motion.button>
        <div className="text-slate-200 font-medium mb-3">Includes:</div>
        <ul className="text-slate-400 text-sm space-y-3 grow">
          {props.features.map((feature, index) => {
            return (
              <li key={index} className="flex items-center">
                <svg className="w-3 h-3 fill-emerald-500 mr-3 shrink-0" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                </svg>
                <span>{feature}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default function PricingTable() {
  const [isAnnual, setIsAnnual] = useState<boolean>(true)

  return (
    <div>

      <div className="flex justify-center max-w-[14rem] m-auto mb-8 lg:mb-16">
        <div className="relative flex w-full p-1 bg-black rounded-full">
          <span className="absolute inset-0 m-1 pointer-events-none" aria-hidden="true">
            <span className={`absolute inset-0 w-1/2 bg-[#5D2CA8] rounded-full shadow-sm shadow-[#5D2CA8] transform transition-transform duration-150 ease-in-out ${isAnnual ? 'translate-x-0' : 'translate-x-full'}`}></span>
          </span>
          <button className={`relative flex-1 text-sm font-medium h-8 rounded-full focus-visible:outline-none focus-visible:ring focus-visible:ring-slate-600 transition-colors duration-150 ease-in-out ${isAnnual ? 'text-white/70' : ' text-white'}`} onClick={() => setIsAnnual(true)} aria-pressed={isAnnual}>Yearly <span className={`${isAnnual ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>-20%</span></button>
          <button className={`relative flex-1 text-sm font-medium h-8 rounded-full focus-visible:outline-none focus-visible:ring focus-visible:ring-slate-600 transition-colors duration-150 ease-in-out ${isAnnual ? 'text-white/70' : ' text-white'}`} onClick={() => setIsAnnual(false)} aria-pressed={isAnnual}>Monthly</button>
        </div>
      </div>

      <div className="max-w-sm mx-auto grid gap-6 lg:grid-cols-3 items-start lg:max-w-none">

        
        <PricingTab
          yearly={isAnnual}
          planName="Hobby"
          price={{ yearly: 0, monthly: 0 }}
          planDescription="Perfect for side projects and learning."
          features={[
            '1 Concurrent Build',
            'Unlimited Static Sites',
            'Community Support',
            'Automatic SSL',
          ]} />

        <PricingTab
          yearly={isAnnual}
          popular={true}
          planName="Pro"
          price={{ yearly: 19, monthly: 29 }}
          planDescription="For professional developers and shipping apps."
          features={[
            '5 Concurrent Builds',
            'Preview Deployments',
            'Custom Domains',
            'Email Support',
            'Analytics',
          ]} />

        <PricingTab
          yearly={isAnnual}
          planName="Enterprise"
          price={{ yearly: 99, monthly: 149 }}
          planDescription="For large teams and high-traffic applications."
          features={[
            'Unlimited Concurrent Builds',
            'Dedicated Infrastructure',
            'SLA & Uptime Guarantee',
            '24/7 Priority Support',
            'SSO & Security',
            'Audit Logs',
          ]} />

      </div>

    </div>
  )
}