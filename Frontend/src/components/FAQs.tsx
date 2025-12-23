"use client"
import { useState } from "react";
import PlusIcon from "../assets/icons/plus.svg";
import MinusIcon from "../assets/icons/minus.svg";
import clsx from "clsx";
import { motion, AnimatePresence } from 'framer-motion';
const items = [
  {
    question: "What is Launchpad?",
    answer:
      "Launchpad is a high-performance frontend deployment platform that allows you to deploy your web applications with a single click. We handle the infrastructure, scaling, and security so you can focus on code.",
  },
  {
    question: "How do I deploy my project?",
    answer:
      "Simply paste your GitHub repository URL into our Launch page, choose a project name, and hit Launch. We'll automatically build and deploy your application.",
  },
  {
    question: "Is it free to use?",
    answer:
      "Yes! We offer a generous free tier for hobbyists and developers. You can deploy unlimited static sites and enjoy free SSL, global CDN, and automatic builds.",
  },
  {
    question: "What technologies power Launchpad?",
    answer:
      "We use Google Cloud Platform for scalable infrastructure, Docker for containerized builds, Redis for real-time logs, and Cloudflare for fast, secure global content delivery.",
  },
];

const AccordinationItem = ({ question, answer }: { question: string, answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (

    <div className=" py-7 border-b border-white/30" onClick={() => setIsOpen(!isOpen)}>
      <div className="flex items-center ">
        <span className="flex-1 text-lg font-bold">{question}</span>
        {isOpen ? <MinusIcon /> : <PlusIcon />}

      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: '16px' }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
          >{answer}</motion.div>

        )}
      </AnimatePresence>

    </div>


  )
}

export const FAQs = () => {
  return (
    <div className="bg-black text-white py-[72px] sm:py-24 bg-gradient-to-b from-[#5D2CA8] to-black ">
      <div className="container">
        <h2 className="text-5xl sm:text-6xl sm:w-[648px] mx-auto text-center text-white tracking-tighter">
          Frequently Asked Questions
        </h2>
        <div className="mt-12 max-w-[648px] mx-auto">
          {items.map(({ question, answer }) => (
            <AccordinationItem question={question} answer={answer} key={question} />
          ))}
        </div>
      </div>
    </div>
  )
};
