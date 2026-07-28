/* Default project list shipped with the extension.
 * Shape per item:
 *   project_name : string (<=100 chars)
 *   duration     : "Mon YYYY to Mon YYYY"  (or give start_month/start_year/end_month/end_year)
 *   description  : string (<=1000 chars)
 *   key_skills   : comma separated string, or array of strings
 *   project_url  : optional
 */
const NKP_DEFAULT_PROJECTS = [
  {
    project_name: "Remo College AI Chatbot - RAG Admissions Assistant",
    duration: "Jan 2025 to Apr 2025",
    description: "Built and deployed a RAG-based AI chatbot for Remo International College admissions site, handling prospective student queries with accurate, scope-restricted responses. Designed the retrieval pipeline over college-specific knowledge, integrated LLM APIs, and deployed it live on the admissions portal. It reduced manual query handling by around 60 percent and automated lead engagement and inquiry-to-admission conversion. I learned a lot about grounding LLM responses to avoid hallucination, chunking and vector search strategies, and making a chatbot production-reliable for a real client.",
    key_skills: "Python, Django, RAG, LangChain, LLM APIs, Vector Databases, REST APIs",
    project_url: "https://admissions2025.remocollege.com/"
  },
  {
    project_name: "Kalinga University Website Backend",
    duration: "Jun 2024 to Dec 2024",
    description: "Built and deployed the production backend for Kalinga Institute of Industrial Technology university website, live at kalingauniversity.ac.in. Developed the system with Django and Python, designing REST APIs for content management, admissions data and dynamic site sections, with database modelling and admin tooling for university staff. Focused on reliability and clean API design since the site serves real prospective students and staff daily. Working on a live institutional platform taught me production discipline - migrations without downtime, careful data validation and building admin interfaces that non-technical staff can actually use.",
    key_skills: "Python, Django, REST APIs, MySQL, Database Modelling, Deployment",
    project_url: "https://kalingauniversity.ac.in/"
  },
  {
    project_name: "INEL - Indian Nippon Backend",
    duration: "Jan 2024 to Jun 2024",
    description: "Developed the production backend for India Nippon Electricals corporate website, live at indianippon.com. Built with Django and Python, implementing secure REST APIs, content and product data management, centralized logging and structured error handling for an enterprise client. Integrated sync frameworks connecting site data with Zoho CRM for lead capture and follow-up. This project sharpened my skills in writing secure, maintainable enterprise code and handling real business data with proper validation, logging and access control.",
    key_skills: "Python, Django, REST APIs, Zoho CRM Integration, Logging, Security",
    project_url: "https://indianippon.com/"
  },
  {
    project_name: "Truliv WhatsApp Conversion Bot",
    duration: "Aug 2024 to Nov 2024",
    description: "Built an AI-powered WhatsApp chatbot for Truliv that converts property leads into confirmed bookings. The bot answers questions about Truliv PG accommodations, qualifies leads through conversation, and guides users toward booking their slots, automating what was previously manual sales follow-up. Integrated LLM-based conversation handling with WhatsApp Business APIs and CRM sync so every interaction is tracked. I enjoyed designing conversation flows that feel natural while still driving a business outcome, and learned how to keep LLM responses on-brand and factually restricted to real property data.",
    key_skills: "Python, LLM APIs, WhatsApp Business API, Zoho CRM, Conversational AI",
    project_url: "https://github.com/NagiPragalathan/Truliv_bot"
  },
  {
    project_name: "LazAI SDK Open Source Contribution",
    duration: "Feb 2025 to May 2025",
    description: "Contributed to the core functionality of the LazAI Alith SDKs in both Python and Go, an open-source framework for building AI agents in the Web3 ecosystem. Worked on SDK internals, fixing issues and extending core modules used by other developers building on the platform. Contributing to a public SDK taught me to write code to a much higher standard - clear interfaces, backward compatibility, documentation and tests - because real developers depend on it. It also deepened my understanding of AI agent architectures across two languages.",
    key_skills: "Python, Go, Open Source, AI Agents, SDK Development, Git",
    project_url: "https://github.com/0xLazAI/alith"
  }
];
