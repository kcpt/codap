// ==========================================================================
//                        DG.DocumentHelper
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

///* global Promise */
/**
 * @class DocumentHelper
 *
 * Coordinates streaming of documents and document elements. Deals with documents
 * as streamable entities in contrast to the Document Controller that
 * provides operational coordination of document elements. This class addresses
 * how to get documents in and out of CODAP predictably and the Document
 * Controller deals with Documents while they are being presented and
 * interacted with within CODAP.
 *
 * This class, at this point, has no state. It
 * functions, more or less, as a mixin to the App Controller, providing
 * a logically related collection of utility methods.
 *
 * @extends SC.Object
 */

DG.DocumentHelper = SC.Object.extend(
    /** @scope DG.DocumentHelper.prototype */ {

      /**
       * Tests the JSON text for validity as a possible document.
       *
       * The following assertions are tested:
       *
       * (1) The document is valid JSON. that is: it parses correctly
       * (2) The document looks like a valid CODAP document. It has all mandatory
       * top level elements and no unexpected top level elements.
       * (3) all internal links can be resolved.
       *
       * @param    {String}    iDocument -- The JSON-formatted document text
       * @returns  {[String]}   An array of error messages, zero length, if none.
       */
      isValidJsonDocument: function (iDocument) {
        function visit(key, value, fn) {
          var rtn = fn(key, value);
          if (rtn !== false) {
            if (Array.isArray(value)) {
              value.forEach(function (item) {
                visit(key, item, fn);
              });
            } else if (typeof value === 'object') {
              DG.ObjectMap.forEach(value, function (key, item) {
                visit(key, item, fn);
              });
            }
          }
        }

        function validateInternalRefs(iDocument) {
          var parts = subDocs.copy(false);
          var symbols = [];
          var references = [];
          parts.unshift(iDocument);
          parts.forEach(function (documentPart) {
            visit('doc', documentPart, function (key, value) {
              if (key === 'guid') {
                // store guids in symbol table
                symbols.push(Number(value));
                return true;
              } else if (key === '_links_') {
                // store links as references
                visit(key, value, function (k, v) {
                  if (k === 'id') {
                    references.push(Number(v));
                  }
                  return true;
                });
                return false;
              } else if (key === 'parent') {
                // store parents as references
                references.push(Number(value));
                return true;
              } else if (key === 'contextStorage') {
                // context storage is private to data interactive
                return false;
              }

            });
          });
          references.forEach(function (ref) {
            // verify link is resolved
            if (symbols.indexOf(Number(ref)) < 0) {
              errors.push('DG.AppController.validateDocument.unresolvedID'.loc(ref));
            }
          });
        }

        var expectedProperties = [
          'appBuildNum',
          'appName',
          'appVersion',
          'changeCount',
          'components',
          'contexts',
          'globalValues',
          'guid',
          'metadata',
          'name',
          '_permissions',
          '_openedFromSharedDocument' // this is an annotation we may create in
                                      // CodapCommonStorage
        ];
        var requiredProperties = [
          'name'
        ];
        var errors = [];
        var doc;
        var subDocs = [];

        if (typeof iDocument === 'string') {
          try {
            doc = JSON.parse(iDocument);
          } catch (ex) {
            errors.push('DG.AppController.validateDocument.parseError'.loc(ex));
          }
        } else {
          doc = iDocument;
        }

        if (doc) {
          requiredProperties.forEach(function (prop) {
                if (!doc.hasOwnProperty(prop)) {
                  errors.push('DG.AppController.validateDocument.missingRequiredProperty'.loc(prop));
                }
              }
          );
          DG.ObjectMap.keys(doc).forEach(function (prop) {
                if (expectedProperties.indexOf(prop) < 0) {
                  // log unexpected properties but don't fail to open
                  DG.log('DG.AppController.validateDocument.unexpectedProperty'.loc(prop));
                }
              }
          );
          validateInternalRefs(doc);
        }
        DG.log('Document validation: ' + (errors.length ? JSON.stringify(errors) : 'No Errors'));
        return errors;
      },

      /**
       * We create a very simple document as a wrapper on the provided Data
       * Interactive URL and open it.
       *
       * @param iURL - URL of data interactive
       * @returns {DG.Document}
       */
      createNewDocumentWithDataInteractives: function (iURLs) {
        var tComponents = (iURLs || [])
            .map(function (url) {
              return {
                "type": "DG.GameView",
                "componentStorage": {
                  "currentGameName": "",
                  "currentGameUrl": url
                }
              };
            });
        var tDoc = {
          name: 'DG.Document.defaultDocumentName'.loc(),
          guid: 1,
          isNewDocument: true, // mark this document as not having been saved and restored.
                               // this property will not be persisted with the document.
          components: tComponents,
          appName: DG.APPNAME,
          appVersion: DG.VERSION,
          appBuildNum: DG.BUILD_NUM,
          globalValues: []
        };

        return DG.Document.createDocument(tDoc);
      },

      updateDataContext: function (iResources, iValues) {
        var context = iResources.dataContext;
        if (context) {
          ['managingController', 'title', 'description', 'preventReorg']
              .forEach(function (prop) {
                if (!SC.none(iValues[prop])) {
                  context.set(prop, iValues[prop]);
                }
              });
        }
        return {
          success: true
        };
      },

      deleteCollection: function( iResources, iRequesterID) {
        var context = iResources.dataContext;
        var collection = iResources.collection;

        if (!collection) {
          return {success: false, values: {error: 'Collection not found'}};
        }

        return context.applyChange({
          operation: 'deleteCollection',
          collection: collection,
          requester: iRequesterID
        });
      },

      createCollection: function(iResources, iValues, iID) {
        // returns a collection for the appropriate parent name, if any.
        function mapParent (context, parentName) {
          var parentKey;
          var collections;
          var collection;

          if (SC.none(parentName)) {
            collections = context.get('collections');
            if (collections && collections.length > 0) {
              parentKey = collections[collections.length - 1].get('id');
            }
          } else if (typeof parentName === 'number') {
            parentKey = parentName;
          } else if (parentName === '_root_') {
            parentKey = null;
          } else {
            collection = context.getCollectionByName(parentName);
            parentKey = collection ? collection.get('id') : null;
          }
          return (!SC.none(parentKey))? context.getCollectionByID(parentKey).collection: null;
        }

        // returns a success indicator and ids.
        function createOneCollection(iContext, iCollectionSpec, iContextID) {
          var change = {
            operation: 'createCollection',
            properties: iCollectionSpec,
            attributes: ( iCollectionSpec && iCollectionSpec.attributes ),
            requester: iContextID
          };
          iCollectionSpec.parent = mapParent(iContext, iCollectionSpec.parent);
          var changeResult = iContext.applyChange(change);
          var success = (changeResult && changeResult.success);
          var ids = changeResult.collection && {
            id: changeResult.collection.get('id'),
            name: changeResult.collection.get('name')
          };
          return {
            success: success,
            values: ids
          };
        }

        var context = iResources.dataContext;
        var success = true;
        var collectionIdentifiers = [];

        if (!context) {
          return {success: false, values: {error: "no context"}};
        }

        if (!Array.isArray(iValues)) {
          iValues = [iValues];
        }

        iValues.every(function (iCollectionSpec) {
          var rslt = createOneCollection(context, iCollectionSpec, iID);
          success = success && rslt.success;
          if (success) {
            collectionIdentifiers.push(rslt.values);
          }
          return success;
        });

        return {success: success, values: collectionIdentifiers};
      },

      applyChangeAndProcessResult: function(context, change, metadata) {
        if (metadata && metadata.dirtyDocument === false)
          change.dirtyDocument = false;
        var changeResult = context.applyChange(change),
            resultAttrs = changeResult && changeResult.attrs,
            returnAttrs = DG.DataInteractiveUtils.mapAttributeProperties(resultAttrs, change.attrPropsArray),
            returnResult = {success: changeResult && changeResult.success};
        if (returnAttrs)
          returnResult.values = { attrs: returnAttrs };
        return returnResult;
      },

      /**
       *
       * @param iResources
       * @param iValues
       * @param iMetadata
       */
      createAttribute: function (iResources, iValues, iMetadata, iRequesterID) {
        if (!iResources.dataContext) {
          return {success: false, values: {error: "no context"}};
        }
        if (!iResources.collection) {
          return {success: false, values: {error: 'Collection not found'}};
        }
        var context = iResources.dataContext;
        var attrSpecs = SC.clone(Array.isArray(iValues) ? iValues : [iValues]);
        if (attrSpecs.some(function(spec) { return !spec.name; })) {
          return {success: false, values: {error: "Create attribute: name required"}};
        }
        attrSpecs.forEach(function(attrSpec) {
          attrSpec.clientName = attrSpec.name;
          attrSpec.name = context.canonicalizeName(attrSpec.name + ' ');
        });
        var change = {
          operation: 'createAttributes',
          collection: context.getCollectionByID( iResources.collection.get('id')),
          attrPropsArray: attrSpecs,
          requester: iRequesterID,
          position: iResources.position
        };
        return this.applyChangeAndProcessResult(context, change, iMetadata);
      },

      /**
       *
       * @param iResources
       * @param iValues
       * @param iMetadata
       */
      updateAttribute: function (iResources, iValues, iMetadata) {

        var context = iResources.dataContext;
        if (!iResources.collection) {
          return {success: false, values: {error: 'Collection not found'}};
        }
        if (!iResources.attribute) {
          return {success: false, values: {error: 'Attribute not found'}};
        }
        if (!iValues.id && iResources.attribute.id)
          iValues.id = iResources.attribute.id;
        if (!iValues.name && iResources.attribute.name)
          iValues.name = iResources.attribute.name;
        else if (iValues.name) {
          iValues.clientName = iValues.name;
          iValues.name = context.canonicalizeName(iValues.name + ' ');
        }
        var change = {
          operation: 'updateAttributes',
          collection: iResources.collection,
          attrPropsArray: [iValues],
          requester: this.get('id')
        };
        return this.applyChangeAndProcessResult(context, change, iMetadata);
      },

      updateAttributeLocation: function(iResources, iValues, iMetadata) {
        var context = iResources.dataContext;
        if (!context) {
          return {
            success: false,
            values: {error: 'context not found'}
          };
        }
        var change = {
          operation: 'moveAttribute',
          requester: this.get('id'),
          attr: iResources.attributeLocation
        };
        if (iValues && !SC.none(iValues.collection)) {
          change.toCollection = context.getCollectionByName(iValues.collection) ||
              context.getCollectionByID(iValues.collection);
          if (!change.toCollection) {
            return {
              success: false,
              values: {error: 'Target collection not found'}
            };
          }
        }
        if (iValues && !SC.none(iValues.position)) {
          change.position = iValues.position;
        }
        return context.applyChange(change);
      },

      createCases: function( iResources, iValues, iRequesterID) {

        function convertDate( iValue) {
          if (iValue instanceof Date) {
            iValue.valueOf = function () {
              return Date.prototype.valueOf.apply(this) / 1000;
            };
          }
        }

        function fixDates(iCase) {
          if( Array.isArray( iCase.values)) {
            iCase.values.forEach(function (iValue) {
              convertDate( iValue);
            });
          }
          else if ( typeof iCase.values === 'object') {
            DG.ObjectMap.forEach( iCase.values, function( iKey, iValue) {
              convertDate( iValue);
            });
          }
        }

        function createOrAppendRequest(iCase) {
          fixDates(iCase);
          var parent = iCase.parent;
          var values = iCase.values;
          var req = requests.find(function (request) {
            return request.properties.parent === parent;
          });
          if (!req) {
            req = {
              operation: 'createCases',
              collection: collection,
              properties: {
                parent: parent
              },
              values: [],
              requester: requester
            };
            requests.push(req);
          }
          req.values.push(values);
        }
        if (!iResources.collection) {
          return {success: false, values: {error: 'Collection not found'}};
        }
        // ------------------createCases-----------------
        var success = true;
        var context = iResources.dataContext;
        var collection = iResources.collection;
        var cases = Array.isArray(iValues)?iValues: [iValues];
        var IDs = [];
        var requester = iRequesterID;
        var requests = [];

        // We wish to minimize the number of change requests submitted,
        // but create case change requests are not structured like cases.
        // we must reformat the Plugin API create/case to some number of
        // change requests, one for each parent referred to in the create/case
        // object.
        cases.forEach(createOrAppendRequest);
        requests.forEach(function (req) {
          var changeResult = context.applyChange(req);
          var success = success && (changeResult && changeResult.success);
          var index;
          if (changeResult.success) {
            for (index = 0; index < changeResult.caseIDs.length; index++) {
              var caseid = changeResult.caseIDs[index];
              var itemid = (index <= changeResult.itemIDs.length) ? changeResult.itemIDs[index] : null;
              IDs.push({id: caseid, itemID: itemid});
            }
          }
        });
        return {success: success, values: IDs};
      },

      /**
       * The current document will be made to conform to the information in the given JSON object.
       * @param iDocObject {Object}
       * @return {boolean}
       */
      updateDocument: function (iDocObject, updateDataContextFunc) {
        var tDocController = DG.currDocumentController(),
            tComponentControllers = tDocController.get('componentControllersMap'),
            tComponentsStorage = iDocObject.components,
            this_ = this;

        function deleteComponentsNotInDocObject() {
          var tIDsOfStoredComponents = tComponentsStorage.map(
              function (iCompStorage) {
                return Number(iCompStorage.guid);
              });
          DG.ObjectMap.forEach(tComponentControllers, function (iGuid, iController) {
            var tFoundStorage = tIDsOfStoredComponents.indexOf(Number(iGuid)) >= 0;
            if (!tFoundStorage) {
              DG.closeComponent(iGuid);
            }
          });
        }

        function deleteDataContextsNotInDocObject() {
          var tExistingContexts = tDocController.get('contextRecords'),
              tIDsOfStoredContexts = iDocObject.contexts.map(
                  function (iContext) {
                    return Number(iContext.guid);
                  });
          DG.ObjectMap.forEach(tExistingContexts, function (iGuid, iContext) {
            var tFoundStorage = tIDsOfStoredContexts.indexOf(Number(iGuid)) >= 0;
            if (!tFoundStorage) {
              tDocController.destroyDataContext(iGuid);
            }
          });
        }

        function synchronizeCollections( iNewDocContextObject, iExistingDocContextRecord) {

          function findCollectionWithID( iContext, iID) {
            return iContext.collections.find( function(iCollection) {
              return Number(iCollection.guid) === Number(iID);
            });
          }

          function deleteCollectionsNotFoundInNewContext() {
            DG.ObjectMap.forEach( iExistingDocContextRecord.collections, function (iID, iExistinCollection) {
              var tFoundNewCollection = findCollectionWithID( iNewDocContextObject, iID),
                  tDataContext = tDocController.getContextByID( iExistingDocContextRecord.get('id'));
              if (!tFoundNewCollection) {
                this_.deleteCollection({
                  dataContext: tDataContext,
                  collection: iExistinCollection
                });
              }
            });
          }

          function addNewCollectionsNotFoundInExistingContext() {
            var tDataContext = tDocController.getContextByID( iExistingDocContextRecord.get('id'));
            iNewDocContextObject.collections.forEach(function (iNewCollection) {
              var tCorrespondingExistingCollection = iExistingDocContextRecord.collections[ iNewCollection.guid];
              if (!tCorrespondingExistingCollection) {
                this_.createCollection({dataContext: tDataContext}, iNewCollection);
              }
            });
          }

          function syncExistingWithNew( iExistingCollection, iNewCollection) {

            function syncAttributes( iExistingAttrs, iNewAttrs) {
              var tExistingDataContext = tDocController.getContextByID(iExistingDocContextRecord.guid);
              // If there are existing attributes not present in new attributes, delete them
              // For those that are found, update them
              iExistingAttrs.forEach(function (iExistingAttr) {
                var tNewAttr = iNewAttrs.find(function (iNewAttr) {
                  return iExistingAttr.cid === iNewAttr.cid;
                });
                if (!tNewAttr) {
                  DG.DataContextUtilities.deleteAttribute(tExistingDataContext, iExistingAttr.get('id'));
                }
                else if( JSON.stringify(tNewAttr) !==
                    JSON.stringify( iExistingAttr.toArchive( true /*fulldata*/))) {  // Sync them up
                  this_.updateAttribute({
                    dataContext: tExistingDataContext,
                    collection: iExistingCollection,
                    attribute: iExistingAttr
                  }, tNewAttr);
                  tNewAttr.__found = true;
                }
              });
              // Create attributes not found in existing collection
              iNewAttrs.forEach(function (iNewAttr, iIndex) {
                if (!iNewAttr.__found) {
                  this_.createAttribute({
                    dataContext: tExistingDataContext,
                    collection: iExistingCollection,
                    position: iIndex
                  }, iNewAttr);
                }
                else delete iNewAttr.__found;
              });
              // Now move attributes to the positions specified by iNewAttrs
              iNewAttrs.forEach(function (iNewAttr, iIndex) {
                this_.updateAttributeLocation({
                      dataContext: tExistingDataContext,
                      attributeLocation: iExistingAttrs.find(function (iExistingAttr) {
                        return iExistingAttr.cid === iNewAttr.cid;
                      })
                    },
                    {
                      collection: iExistingCollection.get('name'),
                      position: iIndex
                    });
              });
            }

            function syncCases( iExistingCases, iNewCases) {
              var tArchiveOfExistingCases = iExistingCases.map( function( iCase) {
                return iCase.toArchive();
              });
              if( JSON.stringify( tArchiveOfExistingCases) !== JSON.stringify( iNewCases)) {
                var tExistingDataContext = tDocController.getContextByID( iExistingDocContextRecord.get('id'));
                iNewCases.forEach( function(iNewCaseObject) {
                  var tExistingCase = tExistingDataContext.getCaseByID( iNewCaseObject.id);
                  if( tExistingCase) {  // update
                    tExistingCase._status = 'updated';
                    if (JSON.stringify(iNewCaseObject) !== JSON.stringify(tExistingCase.toArchive())) {
                      tExistingDataContext.applyChange({
                        operation: 'updateCases',
                        collection: iExistingCollection,
                        cases: [tExistingCase],
                        values: [iNewCaseObject.values]
                      });
                    }
                  }
                  else {
                    var tResult = this_helper.createCases({
                          dataContext: tExistingDataContext,
                          collection: iExistingCollection
                        },
                        iNewCaseObject),
                        tNewCase = tExistingDataContext.getCaseByID( tResult.values[0].id);
                    tNewCase._status = 'updated';
                  }
                });
                // Any cases not updated should be deleted
                iExistingCases.forEach( function( iExistingCase) {
                  if( iExistingCase._status !== 'updated') {
                    tExistingDataContext.applyChange({
                      operation: 'deleteCases',
                      collection: iExistingCollection,
                      cases: [iExistingCase],
                      values: []
                    });
                  }
                  else {
                    // Get rid of flag
                    delete iExistingCase._status;
                  }
                });
              }
            }

            if( JSON.stringify( iExistingCollection.toArchive( false /* dont exclude cases*/)) !==
                JSON.stringify( iNewCollection)) {
              syncAttributes( iExistingCollection.attrs, iNewCollection.attrs);
              syncCases( iExistingCollection.cases, iNewCollection.cases);
            }
          }

          //-----------------------synchronize Collections-----------------------
          var tArchiveOfExistingCollections = [];
          DG.ObjectMap.forEach( iExistingDocContextRecord.collections,
              function( iKey, iCollection) {
                tArchiveOfExistingCollections.push( iCollection.toArchive(true /* fullData */));
              }
          );
          // Are the arrays of collections already the same?
          if (JSON.stringify(iNewDocContextObject.collections) !==
              JSON.stringify(tArchiveOfExistingCollections)) {
            // Not the same. Any collection in doc context but not in new context should be deleted
            deleteCollectionsNotFoundInNewContext();
            // Any new collections not already existing should be created
            addNewCollectionsNotFoundInExistingContext();
            // Sync each collection
            iNewDocContextObject.collections.forEach( function( iNewCollection) {
              var tCorrespondingExistingCollection = iExistingDocContextRecord.collections[ iNewCollection.guid];
              syncExistingWithNew( tCorrespondingExistingCollection, iNewCollection);
            });
          }
        }

        function createOrUpdateDataContexts() {
          var tExistingContexts = tDocController.get('contextRecords'),
              tNewDocContexts = iDocObject.contexts;  // The ones we're moving toward

          tNewDocContexts.forEach(function (iNewDocContext) {
            var tDocContextID = iNewDocContext.guid,
                tExistingDataContextRecord;
            DG.ObjectMap.forEach(tExistingContexts, function (iGuid, iContext) {
              if (Number(iGuid) === tDocContextID)
                tExistingDataContextRecord = iContext;
            });
            if (tExistingDataContextRecord) {  // We found an existing context with the same ID
              var tArchiveOfFoundExistingDocContext = tExistingDataContextRecord.toArchive(true /* fullData */);
              // Is the one we found identical to the one we're moving toward?
              if (JSON.stringify(iNewDocContext) !== JSON.stringify(tArchiveOfFoundExistingDocContext)) {
                // Something's different. First update the toplevel info
                this_.updateDataContext({dataContext: tExistingDataContextRecord}, iNewDocContext);

                synchronizeCollections( iNewDocContext, tExistingDataContextRecord);

              }
            }
            else {
              tDocController.createNewDataContext(iNewDocContext);
            }
          });
        }

        function createOrUpdateComponents() {
          tComponentsStorage.forEach(function (iCompStorage) {
            var tComponentController = tComponentControllers[iCompStorage.guid];
            if (tComponentController) {
              var tComponentView = tComponentController.get('view'),
                  tViewIsMinimized = tComponentView.get('isMinimized')
              tComponentController.restoreComponentStorage(iCompStorage.componentStorage);
              if((tViewIsMinimized && SC.none(iCompStorage.savedHeight))||
                  (!tViewIsMinimized && !SC.none(iCompStorage.savedHeight))) {
                tComponentView.toggleMinimization();
              }
              else {
                tComponentController.get('view').animate(iCompStorage.layout, {duration: 0.4, timing: 'ease-in-out'});
              }
            }
            else {
              iCompStorage.document = DG.activeDocument;
              iCompStorage.allowMoreThanOne = true; // defaults to false and not stored
              var tComponent = DG.Component.createComponent(iCompStorage);
              tDocController.createComponentAndView(tComponent);
            }
          });
        }

        // Global values are not stored in slider components so we have to reinstate them separately
        function reinstateGlobalValues() {
          iDocObject.globalValues.forEach(function (iValue) {
            var tValueInDoc = DG.globalsController.getGlobalValueByID(iValue.guid);
            if (tValueInDoc) {
              tValueInDoc.set('value', iValue.value);
              tValueInDoc.set('name', iValue.name);
            }
            else {
              DG.globalsController.createGlobalValue( {name: iValue.name, value: iValue.value, guid: iValue.guid});
            }
          });
        }

        function reinstateSelection() {
          var tDocContexts = tDocController.get('contexts');
          iDocObject.contexts.forEach(function (iContext) {
            var tDocContext = tDocContexts.find(function (iDocContext) {
              return iDocContext.getPath('model.id') === iContext.guid;
            });
            if (tDocContext) {
              var tSelectedCases = iContext.contextStorage._links_.selectedCases.map(function (iLink) {
                return tDocContext.getCaseByID(iLink.id);
              });
              // allow for a render cycle
              tDocContext.invokeOnceLater(function () {
                tDocContext.applyChange({
                  operation: 'selectCases',
                  select: true,
                  cases: tSelectedCases
                });
              }, 200);
            }
          });
        }

        // Begin updateDocument
        var tResult = true,
            this_helper = this;

        deleteComponentsNotInDocObject();

        deleteDataContextsNotInDocObject();

        reinstateGlobalValues();

        createOrUpdateDataContexts();

        createOrUpdateComponents();

        reinstateSelection();

        DG.UndoHistory.clearUndoRedoHistory();

        return tResult;
      }

    }
);
