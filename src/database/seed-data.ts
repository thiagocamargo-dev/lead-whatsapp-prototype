import type { CreateLeadInput } from '../models/lead.js';

function phone(n: number): string {
  // 55 (Brasil) + 11 (DDD) + 9 (celular) + 8 dígitos sequenciais únicos = 13 dígitos.
  return `551199${String(1000000 + n).slice(-7)}`;
}

/**
 * 40 leads determinísticos cobrindo as 4 faixas de score pedidas no desafio (10 por faixa),
 * com cargos, faturamento e tamanho de empresa variados o suficiente para gerar exemplos
 * reais de qualificados, rejeitados e casos de borda (falsos positivos/negativos) — ver README.
 *
 * Faixa 1 (score < 50) e Faixa 2 (score 50-69): nenhum qualifica, pois falha o critério de
 * score mínimo, independentemente de cargo/empresa.
 * Faixa 3 (70-84) e Faixa 4 (>=85): qualificação depende do sinal adicional (cargo decisório,
 * faturamento >= 1M ou empresa >= 51 funcionários).
 */
export const SEED_LEADS: CreateLeadInput[] = [
  // ---- Faixa 1: score < 50 (10 leads) ----
  { nome: 'Lucas Tavares', telefone: phone(1), empresa: 'StartUp Nova Ideia', cargo: 'Estagiário', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 18, status: 'new' },
  { nome: 'Beatriz Nunes', telefone: phone(2), empresa: 'Comércio Local Ltda', cargo: 'Assistente Administrativo', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 22, status: 'draft' },
  { nome: 'Rafael Souza', telefone: phone(3), empresa: 'Oficina do Rafael', cargo: 'Auxiliar de Vendas', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 27, status: 'new' },
  { nome: 'Camila Duarte', telefone: phone(4), empresa: 'Papelaria Duarte', cargo: 'Recepcionista', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 30, status: 'draft' },
  { nome: 'Thiago Rocha', telefone: phone(5), empresa: 'TechBits Solutions', cargo: 'Analista Júnior de TI', faturamento_anual: '500K-1M', numero_de_funcionarios: '1-10', score: 34, status: 'new' },
  { nome: 'Larissa Pires', telefone: phone(6), empresa: 'Doceria Larissa', cargo: 'Estagiário de Marketing', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 37, status: 'new' },
  { nome: 'Bruno Cardoso', telefone: phone(7), empresa: 'Consultoria Cardoso ME', cargo: 'Assistente de RH', faturamento_anual: '<500K', numero_de_funcionarios: '11-50', score: 40, status: 'new' },
  { nome: 'Juliana Fontes', telefone: phone(8), empresa: 'Boutique Fontes', cargo: 'Auxiliar Administrativo', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 43, status: 'draft' },
  { nome: 'Diego Martins', telefone: phone(9), empresa: 'Martins Transportes', cargo: 'Estagiário de Vendas', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 46, status: 'new' },
  { nome: 'Patrícia Alves', telefone: phone(10), empresa: 'Alves Contabilidade', cargo: 'Analista Júnior', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 48, status: 'new' },

  // ---- Faixa 2: score 50-69 (10 leads) ----
  { nome: 'Fernando Costa', telefone: phone(11), empresa: 'Costa Engenharia', cargo: 'Supervisor de Obras', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 52, status: 'new' },
  { nome: 'Renata Lima', telefone: phone(12), empresa: 'Lima Advocacia', cargo: 'Analista Sênior', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 55, status: 'new' },
  { nome: 'Vitor Hugo Barros', telefone: phone(13), empresa: 'Barros Founders Tech', cargo: 'Founder', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 55, status: 'new' },
  { nome: 'Marina Ferreira', telefone: phone(14), empresa: 'Ferreira Educação', cargo: 'Coordenadora Pedagógica', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 58, status: 'new' },
  { nome: 'Eduardo Salles', telefone: phone(15), empresa: 'Salles Distribuidora', cargo: 'VP Comercial', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 50, status: 'new' },
  { nome: 'Carolina Reis', telefone: phone(16), empresa: 'Reis Marketing Digital', cargo: 'Analista Pleno', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 60, status: 'new' },
  { nome: 'Gabriel Nogueira', telefone: phone(17), empresa: 'Nogueira Diretoria S.A.', cargo: 'Diretor Financeiro', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 63, status: 'draft' },
  { nome: 'Isabela Moraes', telefone: phone(18), empresa: 'Moraes Design Studio', cargo: 'Head de Criação', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 65, status: 'new' },
  { nome: 'Rodrigo Teixeira', telefone: phone(19), empresa: 'Teixeira Logística', cargo: 'Coordenador de Operações', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 67, status: 'new' },
  { nome: 'Amanda Cavalcante', telefone: phone(20), empresa: 'Cavalcante Ventures', cargo: 'CEO', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 68, status: 'new' },

  // ---- Faixa 3: score 70-84 (10 leads) ----
  { nome: 'Marcelo Andrade', telefone: phone(21), empresa: 'Andrade Indústria', cargo: 'CEO', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 78, status: 'new' },
  { nome: 'Fernanda Dias', telefone: phone(22), empresa: 'Dias Consultoria', cargo: 'Diretora Comercial', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 72, status: 'new' },
  { nome: 'Henrique Prado', telefone: phone(23), empresa: 'Prado Tecnologia', cargo: 'Head de Vendas', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 80, status: 'new' },
  { nome: 'Simone Batista', telefone: phone(24), empresa: 'Batista Consultoria Individual', cargo: 'Analista Sênior de Marketing', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 76, status: 'new' },
  { nome: 'Paulo Ramalho', telefone: phone(25), empresa: 'Ramalho Comércio', cargo: 'Gerente Regional', faturamento_anual: '500K-1M', numero_de_funcionarios: '51-200', score: 74, status: 'new' },
  { nome: 'Débora Sales', telefone: phone(26), empresa: 'Sales Corp', cargo: 'Coordenadora de Marketing', faturamento_anual: '20M+', numero_de_funcionarios: '500+', score: 82, status: 'new' },
  { nome: 'André Vasconcelos', telefone: phone(27), empresa: 'Vasconcelos Consultoria', cargo: 'VP de Operações', faturamento_anual: '500K-1M', numero_de_funcionarios: '11-50', score: 70, status: 'new' },
  { nome: 'Tatiane Farias', telefone: phone(28), empresa: 'Farias Studio Individual', cargo: 'Analista de Produto', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 83, status: 'new' },
  { nome: 'Leonardo Freitas', telefone: phone(29), empresa: 'Freitas Startup', cargo: 'Founder', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 71, status: 'new' },
  { nome: 'Renata Vieira', telefone: phone(30), empresa: 'Vieira & Associados', cargo: 'Sócia', faturamento_anual: '1M-5M', numero_de_funcionarios: '11-50', score: 84, status: 'new' },

  // ---- Faixa 4: score >= 85 (10 leads) ----
  { nome: 'Ricardo Monteiro', telefone: phone(31), empresa: 'Monteiro Holding', cargo: 'CEO', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 92, status: 'new' },
  { nome: 'Priscila Nascimento', telefone: phone(32), empresa: 'Nascimento Ventures', cargo: 'Founder', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 88, status: 'new' },
  { nome: 'Otávio Guimarães', telefone: phone(33), empresa: 'Guimarães Corp', cargo: 'Diretor de Operações', faturamento_anual: '20M+', numero_de_funcionarios: '500+', score: 95, status: 'new' },
  { nome: 'Aline Correia', telefone: phone(34), empresa: 'Correia Investimentos', cargo: 'VP Financeiro', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 90, status: 'new' },
  { nome: 'Gustavo Peixoto', telefone: phone(35), empresa: 'Peixoto Tech', cargo: 'Head de Produto', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 86, status: 'new' },
  { nome: 'Vanessa Cunha', telefone: phone(36), empresa: 'Cunha Indústria e Comércio', cargo: 'Gerente de Contas', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 93, status: 'new' },
  { nome: 'Felipe Araújo', telefone: phone(37), empresa: 'Araújo Micro Empresa', cargo: 'Analista Júnior', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 89, status: 'new' },
  { nome: 'Natália Barros', telefone: phone(38), empresa: 'Barros Startup Inicial', cargo: 'Estagiária', faturamento_anual: '<500K', numero_de_funcionarios: '1-10', score: 91, status: 'new' },
  { nome: 'Marcos Vinícius Sá', telefone: phone(39), empresa: 'Sá Participações', cargo: 'Sócio', faturamento_anual: '1M-5M', numero_de_funcionarios: '51-200', score: 87, status: 'new' },
  { nome: 'Cristina Rezende', telefone: phone(40), empresa: 'Rezende Group', cargo: 'Owner', faturamento_anual: '5M-20M', numero_de_funcionarios: '201-500', score: 97, status: 'new' },
];
