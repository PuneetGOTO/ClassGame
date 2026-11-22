/** Solvable number draw and combining operators adapted from hajunho/zeli-web-games Game24 (Apache-2.0).
 *  The campus validator parses and evaluates only four offered integer operands with exact fractions.
 */
import { quiz, shuffle } from "../math";
import { tierValue } from "../../packages/shared/route";
type Rational = readonly [number, number];
const operators = ["+", "-", "*", "/"] as const;
type Operator = typeof operators[number];

function apply(left: Rational, op: Operator, right: Rational): Rational {
  const [a,b] = left, [c,d] = right;
  if (op === "+") return [a*d+c*b, b*d];
  if (op === "-") return [a*d-c*b, b*d];
  if (op === "*") return [a*c,b*d];
  if (c === 0) throw new Error("Division by zero");
  return [a*d,b*c];
}
function solve(terms: { value: Rational; text: string }[]): string | undefined {
  if (terms.length === 1) return terms[0].value[0] === 24 * terms[0].value[1] ? terms[0].text : undefined;
  for (const [i,left] of terms.entries()) {
    for (const [j,right] of terms.entries()) {
      if (i === j) continue;
      const next = terms.filter((_,index) => index !== i && index !== j);
      for (const op of operators) {
        if (op === "/" && right.value[0] === 0) continue;
        const found = solve(next.concat({ value: apply(left.value,op,right.value), text: "(" + left.text + op + right.text + ")" }));
        if (found) return found;
      }
    }
  }
}
const canonical = (numbers: number[]) => numbers.slice().sort((a,b) => a-b).join(",");
export function expressionEquals24(input: string, numbers: number[]) {
  const text = input.replaceAll("×","*").replaceAll("÷","/").replaceAll("−","-");
  if (!/^[0-9+*/()\s-]+$/.test(text)) return false;
  const tokens = text.match(/\d+|[+*/()-]/g) ?? [];
  const actual = tokens.filter(token => /^\d+$/.test(token)).map(Number);
  if (canonical(actual) !== canonical(numbers)) return false;
  let index = 0;
  function factor(): Rational {
    const token = tokens[index++];
    if (token === "(") {
      const value = sum();
      if (tokens[index++] !== ")") throw new Error("Missing parenthesis");
      return value;
    }
    if (!token || !/^[1-9]$/.test(token)) throw new Error("Missing operand");
    return [Number(token), 1];
  }
  function product(): Rational {
    let value = factor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const op = tokens[index++] as Operator;
      value = apply(value, op, factor());
    }
    return value;
  }
  function sum(): Rational {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const op = tokens[index++] as Operator;
      value = apply(value, op, product());
    }
    return value;
  }
  try {
    const [top,bottom] = sum();
    return index === tokens.length && top === 24 * bottom;
  } catch { return false; }
}
export default quiz({
  target: 2, count: 2, retryWrong: true,
  course: tier => {
    const count = tierValue(tier, [1, 2, 3, 3]);
    return { count, target: count };
  },
  generate(random, index, tier) {
    if (tier === 1) {
      const operand = 1 + random(7);
      const numbers = shuffle([3, 8, operand, operand], random);
      return { text: "組成 24", numbers, solution: "3*8+" + operand + "-" + operand };
    }
    if (tier === 4 && index === 0) {
      const divisors = [3, 4, 6, 8, 9];
      const divisor = divisors[random(divisors.length)];
      const complement = Array.from({ length: divisor - 1 }, (_, i) => i + 1)
        .filter(value => 24 * value % divisor === 0 && 24 * value / divisor <= 9);
      if (complement.length) {
        const numerator = divisor - complement[random(complement.length)];
        const top = 24 * (divisor - numerator) / divisor;
        const numbers = shuffle([1, numerator, divisor, top], random);
        return { text: "組成 24", numbers, solution: top + "/(1-" + numerator + "/" + divisor + ")" };
      }
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const numbers = Array.from({ length: 4 }, () => 1 + random(9));
      const solution = solve(numbers.map(number => ({ value: [number,1], text: String(number) })));
      if (solution) return { text: "組成 24", numbers, solution };
    }
    return { text: "組成 24", numbers: [1,2,3,4], solution: "(1+2+3)*4" };
  },
  validate: (question, answer) => expressionEquals24(answer, question.numbers!)
});

