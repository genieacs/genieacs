/**
 * Naive DPLL solver for propositional logic adapted from
 * https://github.com/tammet/logictools
 *
 * Origianl code by Tanel Tammet released under the MIT license.
 *
 * Check whether a clause set is satisfiable or contradictory, using a naive
 * implementation of the dpll (Davis-Putnam-Logemann-Loveland) procedure
 * combining truth table search with the resolution-like unit propagation.
 *
 * The standard pure-literal rule is not implemented in this naive version,
 * since it is not really crucial for the algorithm.
 *
 * The code is very similar to the pure table solver, except we use a
 * unit-propagating, derived-varlist-returing satisfiableAt.
 */

/* eslint-disable @typescript-eslint/no-use-before-define */

function satisfiableAt(clauses, varVals, varnr, val): boolean {
  if (varnr !== 0) varVals[varnr] = val;

  const propRes = unitPropagate(clauses, varVals);
  if (propRes === 1) {
    varVals[varnr] = 0;
    return true;
  }

  // if result false (-1) unitPropagate restores the varVals state itself
  if (propRes === -1) {
    varVals[varnr] = 0;
    return false;
  }

  // find next unassigned var to split
  let nextVar = 0;
  for (let i = 1; i < varVals.length; i++) {
    if (varVals[i] === 0) {
      nextVar = i;
      break;
    }
  }

  if (nextVar === 0) throw new Error("Error in satisfiableAt");

  if (
    satisfiableAt(clauses, varVals, nextVar, 1) ||
    satisfiableAt(clauses, varVals, nextVar, -1)
  )
    // not necessary to restore split var: search is halted anyway
    return true;

  // restore split var
  varVals[nextVar] = 0;

  // restore derived vars
  for (let i = 0; i < propRes.length; i++) varVals[propRes[i]] = 0;

  return false;
}

/**
 * Check whether clauses are satisfiable under the varVals assignment, without
 * search.
 *
 * Iterate through all clauses and check whether
 *
 *  - all literals in the clause are assigned false: undo derived units (set
 *    values in varVals to 0) and return false immediately
 *
 *  - a clause contains a literal assigned true: skip further actions on this
 *    clause
 *
 *  - a single literal in the clause is unassigned, all the rest are assigned
 *    false: derive this literal as a unit clause.
 *
 * In case at least one literal is derived during the process above, iterate
 * the whole process until no more new literals are derived.
 *
 * Returns:
 *
 *   1: all clauses were assigned true, hence the clause set is satisfiable.
 *   The whole search will terminate after that.
 *
 *   -1: clause set is contradictory. Derived units have been restored.
 *
 *   a list of derived variables:  the status of the clause set is
 *   undetermined. The values of variables on the list will be restored (set to
 *   0) during backtracking.
 */
function unitPropagate(clauses, varVals): number[] | 1 | -1 {
  // all vars with a value derived in the forthcoming main loop
  const derivedVars = [];

  // the main loop is run, deriving new unit clauses, until either:
  // - the clause set is detected to be unsatisfiable
  // - the clause set is detected to be satisfiable
  // - there are no more derived unit clauses

  for (;;) {
    let allClausesFound = true; // set to false if we find an undetermined clause
    const derivedQueue = []; // derived units (literals) during one iteration
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      let clauseVal = 0;
      let unassignedCount = 0; // count unassigned vars in clause
      let unassignedLit = 0; // 0 means none found for this clause

      for (let j = 0; j < clause.length; j++) {
        const lit = clause[j];
        let nr, polarity;
        if (lit < 0) {
          nr = 0 - lit;
          polarity = -1;
        } else {
          nr = lit;
          polarity = 1;
        }

        if (varVals[nr] === polarity) {
          clauseVal = 1;
          break;
        } else if (varVals[nr] === 0) {
          unassignedCount++;
          unassignedLit = lit;
        }
      }

      if (clauseVal === 1) continue; // clause is subsumed

      // clause is not subsumed by varVals
      if (unassignedCount === 0) {
        for (let j = 0; j < derivedVars.length; j++)
          varVals[derivedVars[j]] = 0; // restore derived
        return -1;
      } else if (unassignedCount === 1) {
        // unassignedLit is a derived literal
        derivedQueue.push(unassignedLit);
      }

      if (unassignedCount !== 0) allClausesFound = false;
    }

    // if all clauses were subsumed or all the variables in a clause had a value
    // no need to restore varVals: whole search finished
    if (allClausesFound) return 1;

    // in case there are any derived units present, store to varVals and
    // iterate the main loop
    if (derivedQueue.length === 0) break;

    // some units were derived: iterate the main loop
    for (let j = 0; j < derivedQueue.length; j++) {
      const lit = derivedQueue[j];
      let nr, polarity;
      if (lit < 0) {
        nr = 0 - lit;
        polarity = -1;
      } else {
        nr = lit;
        polarity = 1;
      }
      varVals[nr] = polarity;
      derivedVars.push(nr);
    }
  }

  return derivedVars;
}

export function naiveDpll(clauses, maxvarnr): boolean {
  // variable values are 0 if not set, 1 if positive, -1 if negative
  const varVals = new Int32Array(maxvarnr + 1);
  return satisfiableAt(clauses, varVals, 0, 0);
}
