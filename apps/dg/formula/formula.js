// ==========================================================================
//                            DG.Formula
//
//  Author:   Kirk Swenson
//
//  Copyright (c) 2014 by The Concord Consortium, Inc. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// ==========================================================================

sc_require('formula/formula_common');
sc_require('formula/formula_context');

/** @class DG.Formula

  The DG.Formula object supports parsing, compilation, and evaluation of
  mathematical expressions. They make use of DG.FormulaContexts to provide
  variable and function references in different contexts.

  @extends SC.Object
 */
DG.Formula = SC.Object.extend((function() {

return {

  /**
    The compilation/evaluation context for the formula.
    @property   {DG.FormulaContext}
   */
  context: null,

  /**
    The original source text for the formula.
    @property   {String}
   */
  source: null,

  /**
    Initialization function.
   */
  init: function() {
    sc_super();

    // Observe our context for dependent changes.
    var context = this.get('context');
    if( context) context.addObserver('namespaceChange', this, 'namespaceDidChange');
    if( context) context.addObserver('dependentChange', this, 'dependentDidChange');
  },

  /**
    Destruction function.
   */
  destroy: function() {
    var context = this.get('context');
    if( context) {
      // Remove observation of context
      context.removeObserver('namespaceChange', this, 'namespaceDidChange');
      context.removeObserver('dependentChange', this, 'dependentDidChange');
      context.destroy();
      this.context = null;
    }
    sc_super();
  },

  /**
    Force a recompilation/reevaluation, including re-parsing the expression.
   */
  invalidate: function() {
    this.notifyPropertyChange('source');
  },

  /**
    Force a recompilation/reevaluation, without a re-parsing the expression.
   */
  invalidateContext: function() {
    this.notifyPropertyChange('context');
  },

  /**
    Observer function called when the context signals that its namespace
    has changed, which generally means that recompilation is required.
    This function just propagates the notification to clients of the formula.
   */
  namespaceDidChange: function( iNotifier, iKey) {
    this.invalidateContext();
    this.notifyPropertyChange( iKey);
    // For some clients, just knowing that a dependent may have changed is sufficient.
    this.notifyPropertyChange('dependentChange');
  },

  /**
    Observer function called when the context signals that one of its
    dependents has changed. This generally means that reevaluation is
    required, but that recompilation is not. This function generally
    just propagates the notification to clients of the formula.
   */
  dependentDidChange: function( iNotifier, iKey) {
    this.notifyPropertyChange( iKey);
  },

  /**
    The output of the PEG.js parser for the formula
    @property   {Object}
   */
  parseCount: 0,
  parsed: function() {
    ++ this.parseCount;
    var source = this.get('source'),
        result;
    try {
      result = source && DG.formulaParser.parse( source);
    }
    catch( err) {
      // Replace the PEG.js-generated SyntaxError message with our own
      err.originalMessage = err.message;
      err.message = err.found ? 'DG.Formula.SyntaxErrorMiddle'.loc( err.found)
                              : 'DG.Formula.SyntaxErrorEnd'.loc();
      throw err;
    }
    return result;
  }.property('source').cacheable(),

  /**
    The JavaScript function generated by walking the parse tree and generating code.
   */
  compiled: function() {
    var parsed = this.get('parsed'),
        context = this.get('context'),
        compiled = null;
    if( !context) {
      context = DG.FormulaContext.create({});
      this.context = context; // no reason to notify, so no set()
    }
    if( parsed) {
      context.willCompile();
      var output = DG.Formula.compileToJavaScript( parsed, context);
      context.didCompile();
      context.completeCompile();
      compiled = DG.FormulaContext.createContextFunction( output);
    }
    return compiled;
  }.property('parsed','context','namespaceChange').cacheable(),

  /**
    Returns true if this formula contains aggregate functions, false otherwise.
    @property {Boolean}
   */
  hasAggregates: function() {
    var hasAggregates = false;
    // Trap any parse errors that might occur
    try {
      // Make sure compilation has occurred. Shouldn't cause extra compilations
      // unless the SproutCore caching model isn't working as expected.
      this.get('compiled');

      var context = this.get('context');
      if( context)
        hasAggregates = context.get('hasAggregates');
    }
    catch(e) {
      // Formulas with parse errors can't cause aggregate function
      // evaluation, therefore we can simply swallow the parse error.
    }
    return hasAggregates;
  }.property('compiled', 'context').cacheable(),

  /**
    Evaluates the expression by compiling it to an intermediate JavaScript
    representation which is then used to create a new Function(...) for
    evaluation. This provides greater performance for formulas that are
    evaluated many times. For formulas that are only evaluated a few times,
    however, the overhead of compilation exceeds any benefit, and so
    evaluateDirect() should be used in those situations.
    @param    {Object}    iEvalContext -- An evaluation context object which allows
                                          clients to pass evaluation-time values to
                                          the evaluation process.
    @returns  {Object}    The evaluated result
   */
  evaluate: function( iEvalContext) {
    var compiled = this.get('compiled'),
        context = this.get('context');
    return compiled && compiled( context, iEvalContext);
  },

  /**
    Evaluates the expression directly without compilation.
    This is more efficient for small numbers of evaluations than the
    compile-to-JavaScript mechanism used by evaluate(), but is inefficient
    for large numbers of evaluations.
    @param    {Object}    iEvalContext -- An evaluation context object which allows
                                          clients to pass evaluation-time values to
                                          the evaluation process.
    @returns  {Object}    The evaluated result
   */
  evaluateDirect: function( iEvalContext) {
    var parsed = this.get('parsed'),
        context = this.get('context');
    if( !context) {
      context = DG.FormulaContext.create({});
      this.context = context; // no reason to notify, so no set()
    }
    return DG.Formula.evaluateParseTree( parsed, context, iEvalContext);
  }

  //@if(debug)
  /**
    Returns an array of parse tree nodes which can be processed iteratively
    without any recursion. Part of an experimental evaluation model which
    never panned out. See evaluatePostfix() for details.
   */
  , postfix: function() {
    var parsed = this.get('parsed'),
        context = this.get('context');
    if( !context) {
      context = DG.FormulaContext.create({});
      this.context = context; // no reason to notify, so no set()
    }
    return DG.Formula.convertToPostfix( parsed, context);
  }.property('parsed','context').cacheable()

  /**
    An experimental evaluation model which converts the parse tree into an array
    which can be processed directly without the recursion required by the parse tree.
    The hypothesis was that there would be a performance penalty in the recursion
    required to walk the infix parse tree, and so pre-processing it into a postfix
    form which eliminated the recursion would show some performance improvement.
    Interestingly, however, performance testing to date has not shown any improvement,
    and the cost of converting to postfix is non-trivial, so we ignore this option.
    @param    {Object}    iEvalContext -- An evaluation context object which allows
                                          clients to pass evaluation-time values to
                                          the evaluation process.
    @returns  {Object}    The evaluated result
   */
  , evaluatePostfix: function( iEvalContext) {
    var postfix = this.get('postfix'),
        context = this.get('context');
    if( !context) {
      context = DG.FormulaContext.create({});
      this.context = context; // no reason to notify, so no set()
    }
    return DG.Formula.evaluatePostfix( postfix, context, iEvalContext);
  }
  //@endif

};

}()));

/*
 * Regular expression for matching an identifier in a CODAP formula which handles Unicode chars u0000-u02FF.
 * Subset of https://github.com/mathiasbynens/unicode-data/blob/master/8.0.0/properties/Alphabetic-regex.js.
 * For full Unicode support, should consider a library like XRegExp (https://github.com/slevithan/xregexp).
 */
DG.Formula.identifierRegExpFirstCharSet = 'A-Za-z_\\xAA\\xB5\\xBA\\xC0-\\xD6\\xD8-\\xF6\\xF8-\\u02C1\\u02C6-\\u02D1\\u02E0-\\u02E4\\u02EC\\u02EE';

// matches simple identifiers
DG.Formula.identifierRegExp = (function() {
  var firstChar = DG.Formula.identifierRegExpFirstCharSet,
      otherChars = '0-9' + firstChar;
  return new RegExp('[%@][%@]*'.fmt(firstChar, otherChars));
}());

// matches function names, i.e. identifiers followed by a left-parenthesis
DG.Formula.functionRegExp = (function() {
  var firstChar = DG.Formula.identifierRegExpFirstCharSet,
      otherChars = '0-9' + firstChar;
  return new RegExp('[%@][%@]*(?=\\()'.fmt(firstChar, otherChars));
}());

// matches non-empty strings consisting entirely of white space characters
DG.Formula.whiteSpaceRegExp = /^[\s\uFEFF\xA0]+$/;

/**
 * Utility function used by some binary operators
 * @param iOperand1
 * @param iOperand2
 * @return {{} | NaN | Error}
 */
DG.Formula.arithmeticStarter = function( iOperand1, iOperand2) {
  var result = {
        isNumeric1: null, isNumeric2: null,
        isDate1: null, isDate2: null,
        empty1: null, empty2: null,
        num1: null, num2: null
      },
      // white-space-only strings default-convert to 0
      isSpaceStr1 = (typeof iOperand1 === "string") &&
          DG.Formula.whiteSpaceRegExp.test(iOperand1),
      isSpaceStr2 = (typeof iOperand2 === "string") &&
          DG.Formula.whiteSpaceRegExp.test(iOperand2);

  result.empty1 = SC.empty(iOperand1);
  result.empty2 = SC.empty(iOperand2);
  result.isDate1 = DG.isDate(iOperand1) || (!isSpaceStr1 && DG.isDateString(iOperand1));
  result.isDate2 = DG.isDate(iOperand2) || (!isSpaceStr2 && DG.isDateString(iOperand2));
  // booleans and strings (if possible) converted, not null values
  result.num1 = !result.empty1 && !isSpaceStr1
      ? (isNaN(iOperand1) ? Number(DG.createDate(iOperand1)) : Number(iOperand1))
      : NaN;
  result.num2 = !result.empty2 && !isSpaceStr2
      ? (isNaN(iOperand2) ? Number(DG.createDate(iOperand2)) : Number(iOperand2))
      : NaN;
  result.isNumeric1 = (result.num1 === result.num1);
  result.isNumeric2 = (result.num2 === result.num2);
  // errors propagate
  if (iOperand1 instanceof Error) return iOperand1;
  if (iOperand2 instanceof Error) return iOperand2;

  // NaNs propagate
  if ((iOperand1 !== iOperand1) || (iOperand2 !== iOperand2))
    return NaN;

  // Leave it to caller to work with result
  return result;
};

DG.Formula.arithmeticFinisher = function( iResult, iOperator) {
  // null values propagate
  if (iResult.empty1 && iResult.empty2)
    return '';
  // null values dominate numeric values
  if ((iResult.empty1 && iResult.isNumeric2) || (iResult.isNumeric1 && iResult.empty2))
    return '';
  // no more special cases - throw an exception
  throw new DG.TypeError(iOperator);
};

DG.Formula.stringFinisher = function( iResult, iOperand1, iOperand2, iOperator) {
  // null values propagate
  if (iResult.empty1 && iResult.empty2)
    return '';
  // null values dominate numeric values
  if ((iResult.empty1 && iResult.isNumeric2) || (iResult.isNumeric1 && iResult.empty2))
    return '';
  // no more special cases - operate on strings
  iOperand1 = String( iOperand1);
  iOperand2 = String( iOperand2);
  switch (iOperator) {
    case '+': return iOperand1 + iOperand2;
    case '<': return iOperand1 < iOperand2;
    case '<=': return iOperand1 <= iOperand2;
  }
};

/**
  Addition function which handles types by our rules rather than JavaScript's.
  Numbers and values interpretable as numeric (e.g. booleans, some strings)
  are added numerically. NaNs propagate. Null values propagate or concatenate
  depending on context. Otherwise, concatenate as strings.
 */
DG.Formula.add = function(iOperand1, iOperand2) {
  var result = DG.Formula.arithmeticStarter( iOperand1, iOperand2);

  if( (result instanceof Error) || typeof result !== 'object')
    return result;

  // values interpretable as numeric are added numerically
  if (result.isNumeric1 && result.isNumeric2)
    return result.isDate1 !== result.isDate2 ?
        DG.createDate((result.num1 + result.num2)) :
        result.num1 + result.num2;

  // Can't use arithmeticFinisher because strings can be concatenated
  // null values propagate
  if (result.empty1 && result.empty2)
    return '';
  // null values dominate numeric values
  if ((result.empty1 && result.isNumeric2) || (result.isNumeric1 && result.empty2))
    return '';
  // null values are concatenated (as empty strings) with string values
  if (result.empty1 && !result.empty2)
    return String(iOperand2);
  if (!result.empty1 && result.empty2)
    return String(iOperand1);

  // no more special cases - concatenate strings
  return DG.Formula.stringFinisher(iOperand1, iOperand2, '+');
};

/**
  Subtraction function which handles types by our rules rather than JavaScript's.
  Numbers and values interpretable as numeric (e.g. booleans, some strings)
  are subtracted numerically. Nulls and NaNs propagate.
 */
DG.Formula.subtract = function(iOperand1, iOperand2) {
  var result = DG.Formula.arithmeticStarter( iOperand1, iOperand2);

  if( (result instanceof Error) || typeof result !== 'object')
    return result;

  // values interpretable as numeric are 1subtracted numerically
  if (result.isNumeric1 && result.isNumeric2) {
    // date minus number results in date
    // all other combinations result in a number
    return (result.isDate1 && !result.isDate2) ?
        DG.createDate((result.num1 - result.num2)) :
        result.num1 - result.num2;
  }
  return DG.Formula.arithmeticFinisher( result, '\u2212');
};

/**
  Comparison function which handles types by our rules rather than JavaScript's.
  Numbers and values interpretable as numeric (e.g. dates, booleans, some strings)
  are compared numerically. Nulls and NaNs propagate.
 */
DG.Formula.lessThan = function(iOperand1, iOperand2) {
  var result = DG.Formula.arithmeticStarter( iOperand1, iOperand2);

  if( (result instanceof Error) || typeof result !== 'object')
    return result;

  // values interpretable as numeric are compared numerically
  if (result.isNumeric1 && result.isNumeric2) {
    return result.num1 < result.num2;
  }
  // no more special cases - compare strings
  return DG.Formula.stringFinisher(result, iOperand1, iOperand2, '<');
};

/**
  Comparison function which handles types by our rules rather than JavaScript's.
  Numbers and values interpretable as numeric (e.g. dates, booleans, some strings)
  are compared numerically. Strings are compared lexically. Nulls and NaNs propagate.
 */
DG.Formula.lessThanOrEqual = function(iOperand1, iOperand2) {
  var result = DG.Formula.arithmeticStarter( iOperand1, iOperand2);

  if( (result instanceof Error) || typeof result !== 'object')
    return result;

  // values interpretable as numeric are compared numerically
  if (result.isNumeric1 && result.isNumeric2) {
    return result.num1 <= result.num2;
  }
  // no more special cases - compare strings
  return DG.Formula.stringFinisher(result, iOperand1, iOperand2, '<=');
};

/**
  Binary operator function which handles types by our rules rather than JavaScript's.
  Numbers and values interpretable as numeric (e.g. booleans, some strings)
  are handled numerically. Errors, nulls and NaNs propagate.
 */
DG.Formula.binaryOperator = function(iOperator, iOperand1, iOperand2) {
  var empty1 = SC.empty(iOperand1),
      empty2 = SC.empty(iOperand2),
      // white-space-only strings default-convert to 0
      isSpaceStr1 = (typeof iOperand1 === "string") &&
                      DG.Formula.whiteSpaceRegExp.test(iOperand1),
      isSpaceStr2 = (typeof iOperand2 === "string") &&
                      DG.Formula.whiteSpaceRegExp.test(iOperand2),
      isDate1 = DG.isDate(iOperand1) || (!isSpaceStr1 && DG.isDateString(iOperand1)),
      isDate2 = DG.isDate(iOperand2) || (!isSpaceStr2 && DG.isDateString(iOperand2)),
      num1 = !empty1 && !isSpaceStr1 ? Number(iOperand1) : NaN,
      num2 = !empty2 && !isSpaceStr2 ? Number(iOperand2) : NaN,
      // booleans and strings (if possible) converted, not null values
      isNumeric1 = (num1 === num1),
      isNumeric2 = (num2 === num2);

  // dates can't be handled by this operator
  if (isDate1 || isDate2)
    throw new DG.TypeError(iOperator);

  // values interpretable as numeric are handled numerically
  if (isNumeric1 && isNumeric2) {
    switch(iOperator) {
      case '*': return num1 * num2;
      case '/': return num1 / num2;
      case '%': return num1 % num2;
      case '^': return Math.pow(num1, num2);
      default: throw new SyntaxError('DG.Formula.SyntaxErrorInvalidOperator').loc(iOperator);
    }
  }

  // errors propagate
  if (iOperand1 instanceof Error) return iOperand1;
  if (iOperand2 instanceof Error) return iOperand2;

  // NaNs propagate
  if ((iOperand1 !== iOperand1) || (iOperand2 !== iOperand2))
    return NaN;

  // null values propagate
  if (empty1 && empty2) return '';
  // null values dominate numeric values
  if ((empty1 && isNumeric2) || (isNumeric1 && empty2))
    return '';

  // no more special cases - throw an exception
  throw new DG.TypeError(iOperator);
};

/**
  Compiles the specified parse tree results into a JavaScript expression
  which can be used with the specified context to compute the result.
  This function walks the parse tree, converting each node to its JavaScript
  equivalent and then combining the nodes appropriately so that the result
  is a single JavaScript expression.
  @param    {Object}            The parse tree results from PEG.js
  @param    {DG.FormulaContext} The context object used for variable/function references
  @returns  {String}            A JavaScript expression suitable for evaluation
 */
DG.Formula.compileToJavaScript = function( iParseTree, iContext) {

  var fnMap;

  /**
    Call the appropriate visit function based on the node type.
   */
  function visit( iNode) {
    var fn = fnMap[ iNode.type];
    return fn && fn( iNode);
  }

  function visitLiteral( iNode) {
    return iNode.value;
  }

  function visitStringLiteral( iNode) {
    return '"' + iNode.value.replace(/"/g, "\\\"") + '"';
  }

  function visitVariable( iNode) {
    // Pass variable references to the context
    return iContext.compileVariable( iNode.name, iContext.getAggregateFunctionIndices());
  }

  function visitFunctionCall( iNode) {
    var fnName = iNode.name.name,
        isAggFn = iContext.isAggregate(fnName),
        i, len = iNode.args && iNode.args.length,
        aggFnIndices = [], args = [];
    iContext.beginFunctionContext({ name: fnName, isAggregate: isAggFn });
    for( i = 0; i < len; ++i) {
      args.push( visit( iNode.args[i]));
    }
    aggFnIndices = iContext.getAggregateFunctionIndices();
    iContext.endFunctionContext({ name: fnName });
    // Pass function references to the context
    return iContext.compileFunction( fnName, args, aggFnIndices);
  }

  function visitTerm( iNode) {
    var useParens = (iNode.type === 'BinaryExpression'),
        expr = visit( iNode);
    if( useParens) expr = '(' + expr + ')';
    return expr;
  }

  function visitUnaryExpression( iNode) {
    return iNode.operator + visitTerm( iNode.expression);
  }

  function visitBinaryExpression( iNode) {
    var leftTerm = visitTerm( iNode.left),
        rightTerm = visitTerm( iNode.right);

    switch( iNode.operator) {
      case '+':
        return 'DG.Formula.add(' + leftTerm + ',' + rightTerm + ')';
      case '-':
        return 'DG.Formula.subtract(' + leftTerm + ',' + rightTerm + ')';
      case '<':
        return 'DG.Formula.lessThan(' + leftTerm + ',' + rightTerm + ')';
      case '>':
        return 'DG.Formula.lessThan(' + rightTerm + ',' + leftTerm + ')';
      case '<=':
        return 'DG.Formula.lessThanOrEqual(' + leftTerm + ',' + rightTerm + ')';
      case '>=':
        return 'DG.Formula.lessThanOrEqual(' + rightTerm + ',' + leftTerm + ')';
    }

    // Convert standard binary operators to calls to DG.Formula.binaryOperator()
    if (['*', '/', '%', '^'].indexOf(iNode.operator) >= 0)
      return 'DG.Formula.binaryOperator("' + iNode.operator + '",' + leftTerm + ',' + rightTerm + ')';

    // Standard binary operators
    return leftTerm + iNode.operator + rightTerm;
  }

  function visitConditionalExpression( iNode) {
    return '(' + visitTerm( iNode.condition) +
            '?' + visitTerm( iNode.trueExpression) +
            ':' + visitTerm( iNode.falseExpression) + ')';
  }

  fnMap = {
    'BooleanLiteral': visitLiteral,
    'NumericLiteral': visitLiteral,
    'StringLiteral': visitStringLiteral,
    'Variable': visitVariable,
    'FunctionCall': visitFunctionCall,
    'UnaryExpression': visitUnaryExpression,
    'BinaryExpression': visitBinaryExpression,
    'ConditionalExpression': visitConditionalExpression
  };

  // Recursively visit every node in the parse tree
  return visit( iParseTree);
};

/**
  Evaluates the specified parse tree by walking the tree and evaluating nodes
  recursively. This function walks the parse tree, evaluating each node and then
  combining the nodes appropriately to come up with the final result.
  @param    {Object}            The parse tree results from PEG.js
  @param    {DG.FormulaContext} The context object used for variable/function references
  @returns  {Object}            The result of evaluation
 */
DG.Formula.evaluateParseTree = function( iParseTree, iContext, iEvalContext) {

  var fnMap;

  function visit( iNode) {
    var fn = fnMap[ iNode.type];
    return fn && fn( iNode);
  }

  function visitLiteral( iNode) {
    return iNode.value;
  }

  function visitVariable( iNode) {
    // Pass variable references to the context
    return iContext.evaluateVariable( iNode.name, iEvalContext);
  }

  function visitFunctionCall( iNode) {
    var i, len = iNode.args && iNode.args.length,
        args = [];
    for( i = 0; i < len; ++i) {
      args.push( visit( iNode.args[i]));
    }
    // Pass function references to the context
    return iContext.evaluateFunction( iNode.name.name, args);
  }

  function visitUnaryExpression( iNode) {
    var value = visit( iNode.expression);
    switch( iNode.operator) {
    case '+': return +value;
    case '-': return -value;
    case '!': return !value;
    }

    // Error: Unrecognized operator! Throw an exception?
    return undefined;
  }

  function visitBinaryExpression( iNode) {
    var left = visit( iNode.left),
        right = visit( iNode.right);

    switch (iNode.operator) {
      case '^':
        return DG.Formula.binaryOperator('^', left, right);
      case '*':
        return DG.Formula.binaryOperator('*', left, right);
      case '/':
        return DG.Formula.binaryOperator('/', left, right);
      case '%':
        return DG.Formula.binaryOperator('%', left, right);
      case '+':
        return DG.Formula.add(left, right);
      case '-':
        return DG.Formula.subtract(left, right);
      case '<':
        return DG.Formula.lessThan(left, right);
      case '>':
        return DG.Formula.lessThan(right, left);
      case '<=':
        return DG.Formula.lessThanOrEqual(left, right);
      case '>=':
        return DG.Formula.lessThanOrEqual(right, left);
      case '==':
      case '===':
        return left === right;
      case '!=':
      case '!==':
        return left !== right;
      case '&&':
        return left && right;
      case '||':
        return left || right;
      default:
    }

    // Error: Unrecognized operator! Throw an exception
    throw new SyntaxError('DG.Formula.SyntaxErrorInvalidOperator'.loc(iNode.operator));
  }

  function visitConditionalExpression( iNode) {
    return visit( iNode.condition) ? visit( iNode.trueExpression)
                                   : visit( iNode.falseExpression);
  }

  fnMap = {
    'BooleanLiteral': visitLiteral,
    'NumericLiteral': visitLiteral,
    'StringLiteral': visitLiteral,
    'Variable': visitVariable,
    'FunctionCall': visitFunctionCall,
    'UnaryExpression': visitUnaryExpression,
    'BinaryExpression': visitBinaryExpression,
    'ConditionalExpression': visitConditionalExpression
  };

  return visit( iParseTree);
};


//@if(debug)
/**
  An experimental evaluation model which converts the parse tree into an array
  which can be processed directly without the recursion otherwise required.
  The hypothesis was that there would be a performance penalty in the recursion
  required to walk the infix parse tree, and so pre-processing it into a postfix
  form which eliminated the recursion would show some performance improvement.
  @param    {Object}            The parse tree results from PEG.js
  @param    {DG.FormulaContext} The context object used for variable/function references
  @returns  {Array}             The array of nodes in postfix evaluation order
 */
DG.Formula.convertToPostfix = function( iParseTree, iContext) {

  var fnMap, postfix = [];

  function visit( iNode) {
    var fn = fnMap[ iNode.type];
    return fn && fn( iNode);
  }

  function visitLeaf( iNode) {
    postfix.push( iNode);
  }

  function visitFunctionCall( iNode) {
    var i, len = iNode.args && iNode.args.length;
    for( i = 0; i < len; ++i) {
      visit( iNode.args[i]);
    }
    postfix.push( iNode);
  }

  function visitUnaryExpression( iNode) {
    visit( iNode.expression);
    postfix.push( iNode);
  }

  function visitBinaryExpression( iNode) {
    visit( iNode.left);
    visit( iNode.right);
    postfix.push( iNode);
  }

  function visitConditionalExpression( iNode) {
    visit( iNode.condition);
    visit( iNode.trueExpression);
    visit( iNode.falseExpression);
    postfix.push( iNode);
  }

  fnMap = {
    'BooleanLiteral': visitLeaf,
    'NumericLiteral': visitLeaf,
    'StringLiteral': visitLeaf,
    'Variable': visitLeaf,
    'FunctionCall': visitFunctionCall,
    'UnaryExpression': visitUnaryExpression,
    'BinaryExpression': visitBinaryExpression,
    'ConditionalExpression': visitConditionalExpression
  };

  visit( iParseTree);
  return postfix;
};


/**
  An experimental evaluation model which converts the parse tree into an array
  which can be processed directly without the recursion otherwise required.
  The hypothesis was that there would be a performance penalty in the recursion
  required to walk the infix parse tree, and so pre-processing it into a postfix
  form which eliminated the recursion would show some performance improvement.
  @param    {Object}            The parse tree results from PEG.js
  @param    {DG.FormulaContext} The context object used for variable/function references
  @returns  {Array}             The array of nodes in postfix evaluation order
 */
DG.Formula.evaluatePostfix = function( iPostfix, iContext) {

  var fnMap, stack = new Array(iPostfix.length), slen = 0;

  function visit( iNode) {
    var fn = fnMap[ iNode.type];
    return fn && fn( iNode);
  }

  function visitLiteral( iNode) {
    stack[slen++] = iNode.value;
  }

  function visitVariable( iNode) {
    stack[slen++] = iContext.evaluateVariable( iNode.name);
  }

  function visitFunctionCall( iNode) {
    var nArgs = iNode.args && iNode.args.length,
        stackArgs = nArgs ? stack.slice( slen - nArgs, slen) : [],
        result = iContext.evaluateFunction( iNode.name.name, stackArgs);
    slen -= nArgs-1;
    stack[slen-1] = result;
  }

  function visitUnaryExpression( iNode) {
    if( !slen) return undefined;

    var result, value = stack[slen-1];
    switch( iNode.operator) {
    case '+': result = +value; break;
    case '-': result = -value; break;
    case '!': result = !value; break;
    }

    stack[slen-1] = result;
  }

  function visitBinaryExpression( iNode) {
    if( slen < 2) return undefined;

    var left = stack[slen-2],
        right = stack[slen-1],
        result;
    switch( iNode.operator) {
    case '^':   result = Math.pow( left, right);  break;
    case '*':   result = left * right;  break;
    case '/':   result = left / right;  break;
    case '%':   result = left % right;  break;
    case '+':   result = left + right;  break;
    case '-':   result = left - right;  break;
    case '<':   result = left < right;  break;
    case '>':   result = left > right;  break;
    case '<=':  result = left <= right; break;
    case '>=':  result = left >= right; break;
    case '==':
    case '===': result = left === right; break;
    case '!=':
    case '!==': result = left !== right; break;
    case '&&':  result = left && right; break;
    case '||':  result = left || right; break;
    }

    --slen;
    stack[slen-1] = result;
  }

  function visitConditionalExpression( iNode) {
    if( slen < 3) return undefined;

    var condition = stack[slen-3],
        trueExp = stack[slen-2],
        falseExp = stack[slen-1];
    slen -= 2;
    stack[slen-1] = condition ? trueExp : falseExp;
  }

  fnMap = {
    'BooleanLiteral': visitLiteral,
    'NumericLiteral': visitLiteral,
    'StringLiteral': visitLiteral,
    'Variable': visitVariable,
    'FunctionCall': visitFunctionCall,
    'UnaryExpression': visitUnaryExpression,
    'BinaryExpression': visitBinaryExpression,
    'ConditionalExpression': visitConditionalExpression
  };

  iPostfix.forEach( function( iNode) { visit( iNode); });
  return slen > 0 ? stack[slen-1] : undefined;
};
//@endif
