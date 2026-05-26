package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"strings"
)

// IDMLElement represents a scraped layout element from HTML
type IDMLElement struct {
	Type       string  `json:"type"` // "text" or "image"
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	W          float64 `json:"w"`
	H          float64 `json:"h"`
	Text       string  `json:"text,omitempty"`
	Src        string  `json:"src,omitempty"`
	Color      string  `json:"color,omitempty"`
	FontSize   string  `json:"fontSize,omitempty"`
	FontFamily string  `json:"fontFamily,omitempty"`
	TextAlign  string  `json:"textAlign,omitempty"`
}

// IDMLSlide holds elements scraped from a single slide
type IDMLSlide struct {
	Name     string
	Elements []IDMLElement
}

// Map pixels to InDesign points (1 px = 0.75 points)
func pxToPt(px float64) float64 {
	return px * 0.75
}

// cleanXMLString replaces special characters with safe XML entities
func cleanXMLString(str string) string {
	str = strings.ReplaceAll(str, "&", "&amp;")
	str = strings.ReplaceAll(str, "<", "&lt;")
	str = strings.ReplaceAll(str, ">", "&gt;")
	str = strings.ReplaceAll(str, "\"", "&quot;")
	str = strings.ReplaceAll(str, "'", "&apos;")
	return str
}

// GenerateIDMLPackage creates a valid IDML zipped archive from slides
func GenerateIDMLPackage(slides []IDMLSlide, outputPath string) error {
	outFile, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create output IDML file: %w", err)
	}
	defer outFile.Close()

	archive := zip.NewWriter(outFile)
	defer archive.Close()

	// 1. mimetype (MUST be first and uncompressed)
	mimetypeWriter, err := archive.CreateHeader(&zip.FileHeader{
		Name:   "mimetype",
		Method: zip.Store,
	})
	if err != nil {
		return err
	}
	if _, err := mimetypeWriter.Write([]byte("application/vnd.adobe.indesign-idml-package")); err != nil {
		return err
	}

	// 2. META-INF/container.xml
	containerXml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="designmap.xml" media-type="application/vnd.adobe.indesign-idml-package-layout"/>
  </rootfiles>
</container>`
	if err := writeZipFile(archive, "META-INF/container.xml", containerXml); err != nil {
		return err
	}

	// 3. Resources/Styles.xml
	stylesXml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <RootParagraphStyleGroup Self="dParagraphStyleGroup">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" />
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" KeyboardShortcut="0 0 0">
      <Properties>
        <Leading type="enum">AutoLead</Leading>
      </Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
  <RootCharacterStyleGroup Self="dCharacterStyleGroup">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]" />
  </RootCharacterStyleGroup>
  <RootObjectStyleGroup Self="dObjectStyleGroup">
    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" />
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" />
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]" />
  </RootObjectStyleGroup>
  <RootTableStyleGroup Self="dTableStyleGroup">
    <TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]" />
  </RootTableStyleGroup>
  <RootCellStyleGroup Self="dCellStyleGroup">
    <CellStyle Self="CellStyle/$ID/[No cell style]" Name="$ID/[No cell style]" />
  </RootCellStyleGroup>
</idPkg:Styles>`
	if err := writeZipFile(archive, "Resources/Styles.xml", stylesXml); err != nil {
		return err
	}

	// 4. Resources/Graphic.xml
	graphicXml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Color Self="Color/Black" Name="Black" ColorModel="Process" ColorSpace="CMYK" ColorValue="0 0 0 100" />
  <Color Self="Color/Paper" Name="Paper" ColorModel="Process" ColorSpace="CMYK" ColorValue="0 0 0 0" />
  <Color Self="Color/Registration" Name="Registration" ColorModel="Process" ColorSpace="CMYK" ColorValue="100 100 100 100" />
  <Swatch Self="Swatch/None" Name="None" />
  <Color Self="Color/Red" Name="Red" ColorModel="Process" ColorSpace="RGB" ColorValue="255 0 0" />
  <Color Self="Color/Green" Name="Green" ColorModel="Process" ColorSpace="RGB" ColorValue="0 255 0" />
  <Color Self="Color/Blue" Name="Blue" ColorModel="Process" ColorSpace="RGB" ColorValue="0 0 255" />
</idPkg:Graphic>`
	if err := writeZipFile(archive, "Resources/Graphic.xml", graphicXml); err != nil {
		return err
	}

	// 5. MasterSpreads/MasterSpread_M1.xml
	masterSpreadXml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:MasterSpread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <MasterSpread Self="MasterSpread/M1" Name="A-Master" ShowMasterItems="true">
    <Page Self="Page/Master_M1_L" PageSide="LeftHand" MasterPageTransform="1 0 0 1 0 0" GeometricBounds="0 0 576 768"/>
    <Page Self="Page/Master_M1_R" PageSide="RightHand" MasterPageTransform="1 0 0 1 0 0" GeometricBounds="0 0 576 768"/>
  </MasterSpread>
</idPkg:MasterSpread>`
	if err := writeZipFile(archive, "MasterSpreads/MasterSpread_M1.xml", masterSpreadXml); err != nil {
		return err
	}

	// 6. Spreads and Stories
	var spreadRefs []string
	var storyRefs []string

	for i, slide := range slides {
		spreadName := fmt.Sprintf("Spread_S%d", i+1)
		spreadRefs = append(spreadRefs, spreadName)

		// 6a. Stories
		for eIdx, el := range slide.Elements {
			if el.Type == "text" {
				storyName := fmt.Sprintf("Story_S%d_E%d", i+1, eIdx)
				storyRefs = append(storyRefs, storyName)

				storyContent := buildStoryXML(i, eIdx, el)
				if err := writeZipFile(archive, fmt.Sprintf("Stories/%s.xml", storyName), storyContent); err != nil {
					return err
				}
			}
		}

		// 6b. Spreads
		spreadContent := buildSpreadXML(i, slide)
		if err := writeZipFile(archive, fmt.Sprintf("Spreads/%s.xml", spreadName), spreadContent); err != nil {
			return err
		}
	}

	// 7. designmap.xml
	designMap := buildDesignMap(spreadRefs, storyRefs)
	if err := writeZipFile(archive, "designmap.xml", designMap); err != nil {
		return err
	}

	return nil
}

func writeZipFile(archive *zip.Writer, filename string, content string) error {
	w, err := archive.Create(filename)
	if err != nil {
		return err
	}
	_, err = io.WriteString(w, content)
	return err
}

func buildDesignMap(spreadRefs []string, storyRefs []string) string {
	var spreadsXML strings.Builder
	for _, ref := range spreadRefs {
		spreadsXML.WriteString(fmt.Sprintf(`  <idPkg:Spread src="Spreads/%s.xml" />`+"\n", ref))
	}

	var storiesXML strings.Builder
	for _, ref := range storyRefs {
		storiesXML.WriteString(fmt.Sprintf(`  <idPkg:Story src="Stories/%s.xml" />`+"\n", ref))
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0" Self="d" ZeroPoint="0 0" ActiveProcess="CMYK">
  <idPkg:Graphic src="Resources/Graphic.xml" />
  <idPkg:Styles src="Resources/Styles.xml" />
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_M1.xml" />
%s
%s
  <DocumentPreference PageWidth="768" PageHeight="576" PagesPerDocument="1" SideBySide="false" ViewSetUp="SinglePage" />
  <Layer Self="Layer/Layer 1" Name="Layer 1" Visible="true" Locked="false" ShowGuides="true" SnapToGuides="true" UserColor="LightBlue" />
</Document>`, spreadsXML.String(), storiesXML.String())
}

func buildStoryXML(slideIndex int, elIndex int, el IDMLElement) string {
	cleanText := cleanXMLString(el.Text)
	fontSize := 14.0
	if el.FontSize != "" {
		fmt.Sscanf(el.FontSize, "%fpx", &fontSize)
		fontSize = fontSize * 0.75
	}

	fontFamily := "Arial"
	if el.FontFamily != "" {
		parts := strings.Split(el.FontFamily, ",")
		if len(parts) > 0 {
			fontFamily = strings.Trim(parts[0], "\"' ")
		}
	}

	align := "LeftAlign"
	switch strings.ToLower(el.TextAlign) {
	case "center":
		align = "CenterAlign"
	case "right":
		align = "RightAlign"
	case "justify":
		align = "JustifyLeftAlign"
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Story Self="Story_S%d_E%d">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle" Justification="%s">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="%f" AppliedFont="%s">
        <Content>%s</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`, slideIndex+1, elIndex, align, fontSize, fontFamily, cleanText)
}

func buildSpreadXML(index int, slide IDMLSlide) string {
	widthPt := pxToPt(1024)
	heightPt := pxToPt(768)

	var elementsXML strings.Builder

	for eIdx, el := range slide.Elements {
		xPt := pxToPt(el.X)
		yPt := pxToPt(el.Y)
		wPt := pxToPt(el.W)
		hPt := pxToPt(el.H)

		top := yPt
		left := xPt
		bottom := yPt + hPt
		right := xPt + wPt

		if el.Type == "text" {
			elementsXML.WriteString(fmt.Sprintf(`
    <TextFrame Self="TextFrame/%d_%d" ParentStory="Story_S%d_E%d" ItemLayer="Layer/Layer 1" ContentRotation="0" TextFrameIndex="0" GeometricBounds="%f %f %f %f" FillColor="Swatch/None" StrokeColor="Swatch/None">
      <Properties>
        <PathGeometry>
          <GeometryPathType PathOpen="false">
            <PathPointArray>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
            </PathPointArray>
          </GeometryPathType>
        </PathGeometry>
      </Properties>
    </TextFrame>`, index, eIdx, index+1, eIdx, top, left, bottom, right,
				left, top,
				right, top,
				right, bottom,
				left, bottom))

		} else if el.Type == "image" {
			imgSrc := cleanXMLString(el.Src)

			elementsXML.WriteString(fmt.Sprintf(`
    <Rectangle Self="Rectangle/%d_%d" ItemLayer="Layer/Layer 1" ContentRotation="0" GeometricBounds="%f %f %f %f" ContentType="GraphicType" FillColor="Swatch/None" StrokeColor="Swatch/None">
      <Properties>
        <PathGeometry>
          <GeometryPathType PathOpen="false">
            <PathPointArray>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
              <PathPointType Anchor="%f %f"/>
            </PathPointArray>
          </GeometryPathType>
        </PathGeometry>
      </Properties>
      <Image Self="Image/%d_%d" ImageIOPreference="Proxy" HorizontalLayout="Center" VerticalLayout="Center">
        <Link Self="Link/%d_%d" LinkResourceURI="%s" FilePath="%s"/>
      </Image>
    </Rectangle>`, index, eIdx, top, left, bottom, right,
				left, top,
				right, top,
				right, bottom,
				left, bottom,
				index, eIdx, index, eIdx, imgSrc, imgSrc))
		}
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Spread Self="Spread/S%d" ShowMasterItems="true">
    <Page Self="Page/P%d" MasterPageTransform="1 0 0 1 0 0" GeometricBounds="0 0 %f %f"/>
%s
  </Spread>
</idPkg:Spread>`, index+1, index+1, heightPt, widthPt, elementsXML.String())
}
